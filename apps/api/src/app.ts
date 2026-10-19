import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { z, ZodError } from 'zod';
import { PrismaClient, Prisma } from '@omnichat/database';
import { OmniRoute, GatewayError } from '@omnichat/omniroute';
import { exportMarkdown } from '@omnichat/core';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { extname, join, basename } from 'node:path';
import pdf from 'pdf-parse/lib/pdf-parse.js';
import { loadConfig, type AppConfig } from './config.js';
import { authenticate, checkOrigin, hashPassword, verifyPassword, issueSession, HttpError } from './security.js';
import * as serialize from './serializers.js';
import { registerChat } from './chat.js';
import { registerGenerations } from './generations.js';
import { registerCodingLocal } from './coding-local.js';
import { registerCodingCommands } from './coding-executor.js';
import { registerCoding } from './coding.js';
import { registerWorkspace } from './workspace.js';

export type Context = {db:PrismaClient;gateway:OmniRoute;config:AppConfig;active:Map<string,AbortController>};
const idParams=z.object({id:z.string().uuid()});
export const idOf=(request:{params:unknown})=>idParams.parse(request.params).id;
export async function ownedConversation(db:PrismaClient,id:string,userId:string) {
  const row=await db.conversation.findFirst({where:{id,userId,deletedAt:null}});
  if(!row) throw new HttpError(404,'NOT_FOUND','Conversation not found.');
  return row;
}
export async function buildApp(options:{db?:PrismaClient;gateway?:OmniRoute;config?:AppConfig;logger?:boolean}={}) {
  const config=options.config??loadConfig();
  const db=options.db??new PrismaClient();
  const gateway=options.gateway??new OmniRoute({baseUrl:config.gatewayUrl,apiKey:config.gatewayKey,allowNoAuth:config.allowNoAuth,overrides:config.overrides});
  const ctx:Context={db,gateway,config,active:new Map()};
  const app=Fastify({logger:options.logger??{redact:['req.headers.authorization','req.headers.cookie','res.headers.set-cookie']},bodyLimit:1024*1024,requestTimeout:300_000});
  await app.register(cookie);
  await app.register(cors,{origin:config.origins,credentials:true});
  await app.register(helmet,{contentSecurityPolicy:false});
  await app.register(rateLimit,{max:180,timeWindow:60_000});
  await app.register(multipart,{limits:{fileSize:10*1024*1024,files:1,fields:5,parts:6}});
  app.addHook('preHandler',async request=>checkOrigin(request,config));
  app.setErrorHandler((error,request,reply)=>{
    if(error instanceof ZodError) return reply.status(400).send({error:{code:'VALIDATION',message:error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; ')}});
    if(error instanceof HttpError || error instanceof GatewayError) return reply.status(error instanceof HttpError?error.statusCode:error.status).send({error:{code:error.code,message:error.message}});
    if(error instanceof Prisma.PrismaClientKnownRequestError && error.code==='P2002') return reply.status(409).send({error:{code:'CONFLICT',message:'This record or request already exists.'}});
    const code=(error as {statusCode?:number}).statusCode;
    if(code && code>=400 && code<500) return reply.status(code).send({error:{code:'REQUEST_REJECTED',message:code===413?'The file or request is too large.':'The request could not be accepted.'}});
    request.log.error({err:{name:error instanceof Error?error.name:'UnknownError',code:(error as {code?:string}).code}},'Request failed');
    return reply.status(500).send({error:{code:'INTERNAL',message:'The request could not be completed. Please try again.'}});
  });
  app.get('/health',async()=>{await db.$queryRaw`SELECT 1`;return {status:'ok'};});
  const authBody=z.object({email:z.string().email().max(254).transform(v=>v.trim().toLowerCase()),password:z.string().min(12).max(128),client:z.enum(['native','web']).optional()});
  const publicUser=(u:{id:string;name:string;email:string})=>({id:u.id,name:u.name,email:u.email});
  app.post('/api/auth/register',{config:{rateLimit:{max:5,timeWindow:60_000}}},async(request,reply)=>{
    const body=authBody.extend({name:z.string().trim().min(1).max(80)}).parse(request.body);
    const user=await db.user.create({data:{email:body.email,name:body.name,passwordHash:await hashPassword(body.password),settings:{create:{}}}});
    const token=await issueSession(db,reply,user.id,body.client==='native',config);
    await db.auditEvent.create({data:{userId:user.id,action:'auth.register'}});
    return reply.status(201).send({user:publicUser(user),token});
  });
  app.post('/api/auth/login',{config:{rateLimit:{max:10,timeWindow:60_000}}},async(request,reply)=>{
    const body=authBody.parse(request.body);
    const user=await db.user.findUnique({where:{email:body.email}});
    const dummy='scrypt$32768$8$1$00000000000000000000000000000000$'+'0'.repeat(128);
    const valid=await verifyPassword(body.password,user?.passwordHash??dummy);
    if(!user || !valid) throw new HttpError(401,'INVALID_CREDENTIALS','Email or password is incorrect.');
    const token=await issueSession(db,reply,user.id,body.client==='native',config);
    await db.auditEvent.create({data:{userId:user.id,action:'auth.login'}});
    return {user:publicUser(user),token};
  });
  app.get('/api/auth/me',async request=>({user:publicUser((await authenticate(request,db)).user)}));
  app.post('/api/auth/logout',async(request,reply)=>{
    const session=await authenticate(request,db);await db.session.delete({where:{id:session.id}});
    reply.clearCookie('omnichat_session',{path:'/',secure:config.cookieSecure,httpOnly:true,sameSite:'lax'});return {ok:true};
  });
  for(const path of ['/api/models','/api/status']) app.get(path,async request=>{await authenticate(request,db);return gateway.discover();});
  app.post('/api/models/refresh',{config:{rateLimit:{max:10,timeWindow:60_000}}},async request=>{await authenticate(request,db);return gateway.discover(true);});
  app.get('/api/conversations',async request=>{
    const {userId}=await authenticate(request,db);
    const query=z.object({q:z.string().max(200).optional(),cursor:z.string().uuid().optional()}).parse(request.query);
    if(query.cursor) await ownedConversation(db,query.cursor,userId);
    const rows=await db.conversation.findMany({where:{userId,deletedAt:null,...(query.q?{OR:[{title:{contains:query.q,mode:'insensitive' as const}},{messages:{some:{content:{contains:query.q,mode:'insensitive' as const}}}}]}:{})},orderBy:[{pinned:'desc'},{updatedAt:'desc'},{id:'desc'}],take:51,...(query.cursor?{cursor:{id:query.cursor},skip:1}:{})});
    return {items:rows.slice(0,50).map(serialize.conversation),nextCursor:rows.length>50?rows[49]!.id:null};
  });
  app.post('/api/conversations',async(request,reply)=>{
    const {userId}=await authenticate(request,db);const body=z.object({title:z.string().trim().min(1).max(200).optional(),modelId:z.string().max(300).optional()}).parse(request.body??{});
    return reply.status(201).send(serialize.conversation(await db.conversation.create({data:{userId,...body}})));
  });
  app.post('/api/conversations/import',async(request,reply)=>{
    const {userId}=await authenticate(request,db);
    const importedMessage=z.object({id:z.string().uuid(),parentId:z.string().uuid().nullable(),role:z.enum(['user','assistant','system']),content:z.string().max(100000),modelId:z.string().max(300).nullable(),status:z.enum(['pending','streaming','complete','cancelled','error']),createdAt:z.string().datetime().optional(),inputTokens:z.number().int().nonnegative().max(2147483647).nullable().optional(),outputTokens:z.number().int().nonnegative().max(2147483647).nullable().optional()});
    const body=z.object({conversation:z.object({title:z.string().trim().min(1).max(200),modelId:z.string().max(300).nullable().optional(),systemPrompt:z.string().max(16000).nullable().optional(),temperature:z.number().min(0).max(2).nullable().optional(),maxTokens:z.number().int().min(1).max(128000).nullable().optional()}),messages:z.array(importedMessage).max(500)}).parse(request.body);
    const map=new Map(body.messages.map(m=>[m.id,randomUUID()]));
    if(map.size!==body.messages.length)throw new HttpError(400,'INVALID_IMPORT','Imported message IDs must be unique.');
    const byId=new Map(body.messages.map(m=>[m.id,m]));
    for(const item of body.messages){const visited=new Set<string>();let current:string|null=item.id;while(current){if(visited.has(current))throw new HttpError(400,'INVALID_IMPORT','Imported message branches must not contain cycles.');visited.add(current);const ancestor=byId.get(current);if(!ancestor)throw new HttpError(400,'INVALID_IMPORT','An imported parent message does not exist in this file.');current=ancestor.parentId;}}
    const row=await db.$transaction(async tx=>{
      const conversation=await tx.conversation.create({data:{userId,...body.conversation}});
      if(body.messages.length)await tx.message.createMany({data:body.messages.map(item=>({id:map.get(item.id)!,conversationId:conversation.id,parentId:item.parentId?map.get(item.parentId)!:null,role:item.role,content:item.content,modelId:item.modelId,status:['pending','streaming'].includes(item.status)?'error':item.status,error:['pending','streaming'].includes(item.status)?'This response was incomplete in the imported file.':null,createdAt:item.createdAt?new Date(item.createdAt):new Date(),inputTokens:item.inputTokens,outputTokens:item.outputTokens}))});
      await tx.auditEvent.create({data:{userId,action:'conversation.import'}});return conversation;
    });
    return reply.status(201).send(serialize.conversation(row));
  });
  app.get('/api/conversations/:id',async request=>{
    const {userId}=await authenticate(request,db);const row=await ownedConversation(db,idOf(request),userId);
    const messages=await db.message.findMany({where:{conversationId:row.id},include:{attachments:true},orderBy:[{createdAt:'asc'},{id:'asc'}]});
    return {conversation:serialize.conversation(row),messages:messages.map(serialize.message)};
  });
  app.patch('/api/conversations/:id',async request=>{
    const {userId}=await authenticate(request,db);const id=idOf(request);await ownedConversation(db,id,userId);
    const body=z.object({title:z.string().trim().min(1).max(200).optional(),pinned:z.boolean().optional(),folderId:z.string().uuid().nullable().optional(),modelId:z.string().max(300).nullable().optional(),systemPrompt:z.string().max(16000).nullable().optional(),temperature:z.number().min(0).max(2).nullable().optional(),maxTokens:z.number().int().min(1).max(128000).nullable().optional()}).strict().parse(request.body);
    if(body.folderId && !await db.conversationFolder.findFirst({where:{id:body.folderId,userId}})) throw new HttpError(404,'NOT_FOUND','Folder not found.');
    return serialize.conversation(await db.conversation.update({where:{id},data:body}));
  });
  app.delete('/api/conversations/:id',async request=>{
    const {userId}=await authenticate(request,db);const id=idOf(request);await ownedConversation(db,id,userId);ctx.active.get(id)?.abort();
    await db.conversation.update({where:{id},data:{deletedAt:new Date()}});await db.auditEvent.create({data:{userId,action:'conversation.delete'}});return {ok:true};
  });
  app.get('/api/conversations/:id/export',async(request,reply)=>{
    const {userId}=await authenticate(request,db);const row=await ownedConversation(db,idOf(request),userId);const query=z.object({format:z.enum(['markdown','json']).default('markdown')}).parse(request.query);
    const messages=(await db.message.findMany({where:{conversationId:row.id},include:{attachments:true},orderBy:{createdAt:'asc'}})).map(serialize.message);
    reply.header('Content-Disposition',`attachment; filename="conversation.${query.format==='json'?'json':'md'}"`);
    if(query.format==='json') return reply.type('application/json').send(JSON.stringify({conversation:serialize.conversation(row),messages},null,2));
    return reply.type('text/markdown; charset=utf-8').send(exportMarkdown(serialize.conversation(row),messages));
  });
  app.get('/api/folders',async request=>{const {userId}=await authenticate(request,db);return {items:await db.conversationFolder.findMany({where:{userId},select:{id:true,name:true},orderBy:{name:'asc'}})};});
  app.post('/api/folders',async(request,reply)=>{const {userId}=await authenticate(request,db);const body=z.object({name:z.string().trim().min(1).max(80)}).parse(request.body);return reply.status(201).send(await db.conversationFolder.create({data:{userId,...body},select:{id:true,name:true}}));});
  app.delete('/api/folders/:id',async request=>{const {userId}=await authenticate(request,db);const deleted=await db.conversationFolder.deleteMany({where:{id:idOf(request),userId}});if(!deleted.count) throw new HttpError(404,'NOT_FOUND','Folder not found.');return {ok:true};});
  app.get('/api/settings',async request=>{const {userId}=await authenticate(request,db);return serialize.settings(await db.userSettings.upsert({where:{userId},create:{userId},update:{}}));});
  app.patch('/api/settings',async request=>{
    const {userId}=await authenticate(request,db);
    const body=z.object({theme:z.enum(['light','dark','system']).optional(),defaultModel:z.string().max(300).nullable().optional(),favoriteModels:z.array(z.string().max(300)).max(100).optional(),systemPrompt:z.string().max(16000).optional(),streaming:z.boolean().optional(),animations:z.boolean().optional(),temperature:z.number().min(0).max(2).nullable().optional(),maxTokens:z.number().int().min(1).max(128000).nullable().optional()}).strict().parse(request.body);
    return serialize.settings(await db.userSettings.upsert({where:{userId},create:{userId,...body},update:body}));
  });
  app.get('/api/attachments',async request=>{const {userId}=await authenticate(request,db);return {items:(await db.attachment.findMany({where:{userId},orderBy:{createdAt:'desc'},take:100})).map(serialize.attachment)};});
  app.post('/api/attachments',async(request,reply)=>{
    const {userId}=await authenticate(request,db);const part=await request.file();if(!part) throw new HttpError(400,'FILE_REQUIRED','Choose a file to upload.');
    const name=basename(part.filename.replace(/\\/g,'/')).replace(/[\x00-\x1f\x7f]/g,'').slice(0,180)||'attachment';
    const ext=extname(name).toLowerCase();const bytes=await part.toBuffer();
    if(part.file.truncated) throw new HttpError(413,'FILE_TOO_LARGE','Files must be 10 MB or smaller.');
    let mimeType:string;let extractedText:string|null=null;
    if(['.png','.jpg','.jpeg','.webp'].includes(ext)) {
      const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;const webp=bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
      if(!png&&!jpeg&&!webp) throw new HttpError(400,'INVALID_FILE','The image signature is invalid.');mimeType=png?'image/png':jpeg?'image/jpeg':'image/webp';
    } else if(ext==='.pdf') {
      if(bytes.subarray(0,5).toString()!=='%PDF-') throw new HttpError(400,'INVALID_FILE','The PDF signature is invalid.');
      mimeType='application/pdf';try {extractedText=(await pdf(bytes,{max:200})).text.slice(0,200000);} catch {throw new HttpError(400,'PDF_EXTRACTION','This PDF could not be read. Encrypted and scanned-only PDFs need a text export.');}
    } else if(['.txt','.md','.csv','.json','.js','.jsx','.ts','.tsx','.py','.html','.css','.xml','.yaml','.yml','.log','.sql','.java','.c','.cpp','.rs','.go','.sh'].includes(ext)) {
      mimeType='text/plain';if(bytes.includes(0)) throw new HttpError(400,'INVALID_FILE','This document contains binary data.');extractedText=bytes.toString('utf8').slice(0,200000);
    } else throw new HttpError(400,'UNSUPPORTED_FILE','Upload PDF, text, code, PNG, JPEG, or WebP files.');
    const storageKey=randomUUID();await mkdir(config.uploadDir,{recursive:true});await writeFile(join(config.uploadDir,storageKey),bytes,{flag:'wx',mode:0o600});
    try {const row=await db.attachment.create({data:{userId,name,mimeType,size:bytes.length,storageKey,extractedText}});return reply.status(201).send(serialize.attachment(row));}catch(error){await unlink(join(config.uploadDir,storageKey)).catch(()=>{});throw error;}
  });
  app.get('/api/attachments/:id/download',async(request,reply)=>{
    const {userId}=await authenticate(request,db);const row=await db.attachment.findFirst({where:{id:idOf(request),userId}});if(!row) throw new HttpError(404,'NOT_FOUND','Attachment not found.');
    return reply.type(row.mimeType).header('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`).header('Cache-Control','private, no-store').send(await readFile(join(config.uploadDir,row.storageKey)));
  });
  app.delete('/api/attachments/:id',async request=>{const {userId}=await authenticate(request,db);const row=await db.attachment.findFirst({where:{id:idOf(request),userId}});if(!row)throw new HttpError(404,'NOT_FOUND','Attachment not found.');await db.attachment.delete({where:{id:row.id}});await unlink(join(config.uploadDir,row.storageKey)).catch(()=>{});return {ok:true};});
  app.post('/api/search',{config:{rateLimit:{max:20,timeWindow:60_000}}},async request=>{await authenticate(request,db);const body=z.object({query:z.string().trim().min(1).max(500),modelId:z.string().optional()}).parse(request.body);return {results:await gateway.search(body.query)};});
  registerChat(app,ctx);registerGenerations(app,ctx);registerCodingLocal(app,ctx);registerCoding(app,ctx);registerCodingCommands(app,ctx);registerWorkspace(app,ctx);
  app.addHook('onClose',async()=>{for(const controller of ctx.active.values())controller.abort();if(!options.db)await db.$disconnect();});
  return app;
}
