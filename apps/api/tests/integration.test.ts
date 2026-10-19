import { beforeAll,afterAll,describe,it,expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { mkdir,rm } from 'node:fs/promises';
import { PrismaClient } from '@omnichat/database';
import { OmniRoute } from '@omnichat/omniroute';
import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';

const testUrl=process.env.TEST_DATABASE_URL;
describe.skipIf(!testUrl).sequential('API with isolated PostgreSQL and deterministic gateway',()=>{
  let db:PrismaClient;let app:Awaited<ReturnType<typeof buildApp>>;let token:string;let otherToken:string;let userId:string;let otherId:string;let conversationId:string;
  let chatCalls=0;let mode:'normal'|'truncated'|'cancel'='normal';let onChunk:(()=>void)|undefined;
  const uploadDir=resolve('work',`api-test-${randomUUID()}`);
  const headers=()=>({authorization:`Bearer ${token}`});
  const config:AppConfig={host:'127.0.0.1',port:0,origins:['http://localhost:3210'],cookieSecure:false,sessionDays:1,uploadDir,gatewayUrl:'http://localhost:9999/v1',allowNoAuth:false,gatewayKey:'fixture-only',overrides:{}};
  beforeAll(async()=>{
    db=new PrismaClient({datasourceUrl:testUrl!});
    const gateway=new OmniRoute({baseUrl:config.gatewayUrl,apiKey:'fixture-only',fetch:async(url,init)=>{
      const path=new URL(String(url)).pathname;
      if(path.endsWith('/models'))return Response.json({data:[{id:'test/chat',owned_by:'test',capabilities:{streaming:true},context_length:32000},{id:'test/image',owned_by:'test',type:'image'}]});
      if(path.endsWith('/search') && init?.method!=='POST')return Response.json({data:[{id:'test-search',search_types:['web']}]});
      if(path.endsWith('/search'))return Response.json({results:[{title:'Fixture source',url:'https://example.com/source',snippet:'Search fixture'}]});
      if(path.endsWith('/images/generations'))return Response.json({data:[{url:'https://example.com/image.png'}]});
      if(path.endsWith('/chat/completions')){
        chatCalls++;const current=mode;
        const stream=new ReadableStream<Uint8Array>({start(controller){
          const encode=(value:unknown)=>new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`);
          controller.enqueue(encode({choices:[{delta:{content:'Saved partial'}}]}));onChunk?.();
          if(current==='cancel'){init?.signal?.addEventListener('abort',()=>controller.error(new DOMException('Aborted','AbortError')),{once:true});return;}
          if(current==='normal'){controller.enqueue(encode({choices:[{delta:{content:' response'},finish_reason:'stop'}],usage:{prompt_tokens:9,completion_tokens:3}}));controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));}
          controller.close();
        }});
        return new Response(stream,{headers:{'content-type':'text/event-stream'}});
      }
      return new Response(null,{status:404});
    }});
    app=await buildApp({db,gateway,config,logger:false});await mkdir(uploadDir,{recursive:true});
    for(const label of ['one','two']){
      const response=await app.inject({method:'POST',url:'/api/auth/register',payload:{name:label,email:`api-test-${randomUUID()}@example.test`,password:'test password 12345',client:'native'}});
      expect(response.statusCode).toBe(201);const body=response.json();
      if(label==='one'){token=body.token;userId=body.user.id;}else{otherToken=body.token;otherId=body.user.id;}
    }
  },30000);
  afterAll(async()=>{await app?.close();if(db){await db.user.deleteMany({where:{id:{in:[userId,otherId].filter(Boolean)}}});await db.$disconnect();}await rm(uploadDir,{recursive:true,force:true});});
  it('requires authentication and prevents cross-origin browser mutation',async()=>{
    expect((await app.inject({url:'/api/models'})).statusCode).toBe(401);
    expect((await app.inject({method:'POST',url:'/api/auth/login',headers:{origin:'https://evil.example'},payload:{email:'test@example.test',password:'test password 12345',client:'native'}})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url:'/api/auth/login',payload:{email:'test@example.test',password:'test password 12345'}})).statusCode).toBe(403);
    const session=await db.session.findFirst({where:{userId}});expect(session?.tokenHash).not.toBe(token);expect(session?.tokenHash.length).toBe(64);
  });
  it('discovers actual catalogue types with unknown provider health',async()=>{
    const response=await app.inject({url:'/api/models',headers:headers()});expect(response.statusCode).toBe(200);
    expect(response.json().models[0].availability).toBe('unknown');expect(response.json().endpoints.find((e:any)=>e.id==='video').available).toBe(false);
  });
  it('creates conversations and isolates resource ownership',async()=>{
    const response=await app.inject({method:'POST',url:'/api/conversations',headers:headers(),payload:{}});expect(response.statusCode).toBe(201);conversationId=response.json().id;
    expect((await app.inject({url:`/api/conversations/${conversationId}`,headers:{authorization:`Bearer ${otherToken}`}})).statusCode).toBe(404);
    expect((await app.inject({method:'DELETE',url:`/api/conversations/${conversationId}`,headers:{authorization:`Bearer ${otherToken}`}})).statusCode).toBe(404);
  });
  it('streams and persists complete messages while deduplicating request IDs',async()=>{
    const requestId=randomUUID();const payload={content:'Hello',modelId:'test/chat',requestId};
    const response=await app.inject({method:'POST',url:`/api/conversations/${conversationId}/messages`,headers:headers(),payload});expect(response.statusCode).toBe(200);expect(response.body).toContain('"type":"delta"');
    const count=chatCalls;await app.inject({method:'POST',url:`/api/conversations/${conversationId}/messages`,headers:headers(),payload});expect(chatCalls).toBe(count);
    const saved=await db.message.findUnique({where:{conversationId_requestId:{conversationId,requestId}}});expect(saved?.content).toBe('Saved partial response');expect(saved?.status).toBe('complete');expect(saved?.outputTokens).toBe(3);
  });
  it('preserves a partial response when the provider disconnects',async()=>{
    mode='truncated';const requestId=randomUUID();const response=await app.inject({method:'POST',url:`/api/conversations/${conversationId}/messages`,headers:headers(),payload:{content:'Disconnect',modelId:'test/chat',requestId}});
    expect(response.body).toContain('STREAM_INTERRUPTED');const saved=await db.message.findUnique({where:{conversationId_requestId:{conversationId,requestId}}});expect(saved?.content).toBe('Saved partial');expect(saved?.status).toBe('error');mode='normal';
  });
  it('cancels in-flight work and durably retains partial text',async()=>{
    mode='cancel';const requestId=randomUUID();let received!:()=>void;const firstChunk=new Promise<void>(resolve=>{received=resolve;});onChunk=received;
    const pending=app.inject({method:'POST',url:`/api/conversations/${conversationId}/messages`,headers:headers(),payload:{content:'Cancel',modelId:'test/chat',requestId}});
    // light-my-request is thenable; attach immediately so the request is started.
    const running=Promise.resolve(pending);await firstChunk;
    expect((await app.inject({method:'POST',url:`/api/conversations/${conversationId}/cancel`,headers:headers()})).statusCode).toBe(200);
    await running;const saved=await db.message.findUnique({where:{conversationId_requestId:{conversationId,requestId}}});expect(saved?.status).toBe('cancelled');expect(saved?.content).toBe('Saved partial');mode='normal';onChunk=undefined;
  },15000);
  it('regenerates on the selected branch without duplicating the original user turn',async()=>{
    const original=await db.message.findFirstOrThrow({where:{conversationId,role:'user'},orderBy:{createdAt:'asc'}});const before=await db.message.count({where:{conversationId,role:'user'}});
    const response=await app.inject({method:'POST',url:`/api/conversations/${conversationId}/messages`,headers:headers(),payload:{content:'',modelId:'test/chat',requestId:randomUUID(),parentId:original.id,regenerate:true}});expect(response.statusCode).toBe(200);expect(await db.message.count({where:{conversationId,role:'user'}})).toBe(before);
  });
  it('stores validated text uploads and protects downloads',async()=>{
    const boundary='omnichat-test';const payload=`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="note.txt"\r\nContent-Type: text/plain\r\n\r\nDocument content\r\n--${boundary}--\r\n`;
    const response=await app.inject({method:'POST',url:'/api/attachments',headers:{...headers(),'content-type':`multipart/form-data; boundary=${boundary}`},payload});expect(response.statusCode).toBe(201);const attachment=response.json();expect(attachment.extractedText).toBe('Document content');expect(attachment.storageKey).toBeUndefined();
    expect((await app.inject({url:`/api/attachments/${attachment.id}/download`,headers:{authorization:`Bearer ${otherToken}`}})).statusCode).toBe(404);
    expect((await app.inject({url:`/api/attachments/${attachment.id}/download`,headers:headers()})).body).toBe('Document content');
  });
  it('persists image jobs and rejects unsupported media and options',async()=>{
    const response=await app.inject({method:'POST',url:'/api/generations',headers:headers(),payload:{kind:'images',modelId:'test/image',prompt:'An illustration',requestId:randomUUID()}});expect(response.statusCode).toBe(202);
    const id=response.json().id;for(let i=0;i<30;i++){const row=await db.generationJob.findUnique({where:{id}});if(row?.status==='complete')break;await new Promise(resolve=>setTimeout(resolve,10));}
    const completed=await app.inject({url:`/api/generations/${id}`,headers:headers()});expect(completed.json().status).toBe('complete');expect(completed.json().assets).toHaveLength(1);
    expect((await app.inject({method:'POST',url:'/api/generations',headers:headers(),payload:{kind:'video',modelId:'test/video',prompt:'A film',requestId:randomUUID()}})).statusCode).toBe(409);
    expect((await app.inject({method:'POST',url:'/api/generations',headers:headers(),payload:{kind:'images',modelId:'test/image',prompt:'A drawing',requestId:randomUUID(),options:{size:'1024x1024'}}})).statusCode).toBe(400);
  });
  it('returns actual search results and exports persisted messages',async()=>{
    const search=await app.inject({method:'POST',url:'/api/search',headers:headers(),payload:{query:'fixture'}});expect(search.json().results[0].url).toBe('https://example.com/source');
    const exported=await app.inject({url:`/api/conversations/${conversationId}/export?format=json`,headers:headers()});expect(exported.json().messages.length).toBeGreaterThan(0);
  });
  it('imports branch history with new IDs and rejects cyclic or foreign ancestry',async()=>{
    const exported=(await app.inject({url:`/api/conversations/${conversationId}/export?format=json`,headers:headers()})).json();
    const imported=await app.inject({method:'POST',url:'/api/conversations/import',headers:headers(),payload:exported});
    expect(imported.statusCode).toBe(201);expect(imported.json().id).not.toBe(conversationId);
    const detail=(await app.inject({url:`/api/conversations/${imported.json().id}`,headers:headers()})).json();
    expect(detail.messages.length).toBe(exported.messages.length);
    const oldIds=new Set(exported.messages.map((m:any)=>m.id));expect(detail.messages.every((m:any)=>!oldIds.has(m.id))).toBe(true);
    exported.messages[0].parentId=exported.messages[0].id;
    expect((await app.inject({method:'POST',url:'/api/conversations/import',headers:headers(),payload:exported})).statusCode).toBe(400);
    exported.messages[0].parentId=randomUUID();
    expect((await app.inject({method:'POST',url:'/api/conversations/import',headers:headers(),payload:exported})).statusCode).toBe(400);
  });
  it('rejects a parent or attachment outside the conversation owner',async()=>{
    const foreign=await db.conversation.create({data:{userId:otherId}});
    const parent=await db.message.create({data:{conversationId:foreign.id,role:'user',content:'Private',status:'complete'}});
    const response=await app.inject({method:'POST',url:`/api/conversations/${conversationId}/messages`,headers:headers(),payload:{content:'Branch',modelId:'test/chat',requestId:randomUUID(),parentId:parent.id}});
    expect(response.statusCode).toBe(400);
    expect((await app.inject({method:'POST',url:`/api/conversations/${conversationId}/messages`,headers:headers(),payload:{content:'Attachment',modelId:'test/chat',requestId:randomUUID(),attachmentIds:[randomUUID()]}})).statusCode).toBe(404);
  });
  it('sets HttpOnly browser cookies and requires Origin for cookie mutations',async()=>{
    const email=(await db.user.findUniqueOrThrow({where:{id:userId}})).email;
    const login=await app.inject({method:'POST',url:'/api/auth/login',headers:{origin:'http://localhost:3210'},payload:{email,password:'test password 12345'}});
    expect(login.statusCode).toBe(200);const cookie=String(login.headers['set-cookie']);expect(cookie).toContain('HttpOnly');expect(cookie).toContain('SameSite=Lax');expect(login.json().token).toBeUndefined();
    const browserCookie=cookie.split(';')[0]!;
    expect((await app.inject({method:'POST',url:'/api/conversations',headers:{cookie:browserCookie},payload:{}})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url:'/api/conversations',headers:{cookie:browserCookie,origin:'http://localhost:3210'},payload:{}})).statusCode).toBe(201);
  });
  it('rejects an expired session and does not accept a revoked token',async()=>{
    await db.session.updateMany({where:{userId:otherId},data:{expiresAt:new Date(0)}});
    expect((await app.inject({url:'/api/auth/me',headers:{authorization:`Bearer ${otherToken}`}})).statusCode).toBe(401);
    expect((await app.inject({method:'POST',url:'/api/auth/logout',headers:headers()})).statusCode).toBe(200);
    expect((await app.inject({url:'/api/auth/me',headers:headers()})).statusCode).toBe(401);
  });
});
