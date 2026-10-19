import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { PrismaClient } from '@omnichat/database';
import { OmniRoute } from '@omnichat/omniroute';
import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';

const testUrl=process.env.TEST_DATABASE_URL;
describe.skipIf(!testUrl).sequential('coding projects and bounded agent with PostgreSQL',()=>{
  let db:PrismaClient;let app:Awaited<ReturnType<typeof buildApp>>;let token:string;let otherToken:string;let projectId:string;
  const userIds:string[]=[];let outputs:string[]=[];let calls=0;let lastModelMessages:any[]=[];
  let pause=false;let modelStarted:(()=>void)|undefined;
  const headers=()=>({authorization:`Bearer ${token}`});
  const config:AppConfig={host:'127.0.0.1',port:0,origins:['http://localhost:3210'],cookieSecure:false,sessionDays:1,uploadDir:resolve('work','coding-tests-unused-uploads'),gatewayUrl:'http://localhost:9999/v1',allowNoAuth:false,gatewayKey:'fixture-only',overrides:{}};
  const response=(actions:unknown[],done=false,summary='Prepared requested changes.')=>JSON.stringify({summary,actions,done});
  const files=()=>db.codingFile.findMany({where:{projectId},orderBy:{path:'asc'}});
  async function startRun(prompt='Improve the project',requestId=randomUUID()){
    const result=await app.inject({method:'POST',url:`/api/projects/${projectId}/runs`,headers:headers(),payload:{requestId,modelId:'test/coder',prompt}});
    expect(result.statusCode,result.body).toBe(202);return result.json();
  }
  async function settled(id:string){
    for(let i=0;i<300;i++){const run=await db.codingRun.findUniqueOrThrow({where:{id}});if(run.status!=='running')return run;await new Promise(resolve=>setTimeout(resolve,10));}
    throw new Error('Coding fixture did not settle.');
  }
  beforeAll(async()=>{
    db=new PrismaClient({datasourceUrl:testUrl!});
    const gateway=new OmniRoute({baseUrl:config.gatewayUrl,apiKey:'fixture-only',fetch:async(url,init)=>{
      const path=new URL(String(url)).pathname;
      if(path.endsWith('/models'))return Response.json({data:[{id:'test/coder',owned_by:'fixture',context_length:128000,capabilities:{chat:true,streaming:true}}]});
      if(path.endsWith('/search'))return Response.json({data:[]});
      if(path.endsWith('/chat/completions')){
        calls++;lastModelMessages=JSON.parse(String(init?.body)).messages;modelStarted?.();
        if(pause){const stream=new ReadableStream<Uint8Array>({start(controller){init?.signal?.addEventListener('abort',()=>controller.error(new DOMException('Aborted','AbortError')),{once:true});}});return new Response(stream,{headers:{'content-type':'text/event-stream'}});}
        return Response.json({choices:[{message:{content:outputs.shift()??'invalid fixture response'}}]});
      }
      return new Response(null,{status:404});
    }});
    app=await buildApp({db,gateway,config,logger:false});
    for(let i=0;i<2;i++){
      const result=await app.inject({method:'POST',url:'/api/auth/register',payload:{name:'Coding tester',email:`coding-${randomUUID()}@example.test`,password:'coding test password 123',client:'native'}});
      expect(result.statusCode).toBe(201);const account=result.json();userIds.push(account.user.id);if(i===0)token=account.token;else otherToken=account.token;
    }
    const project=await app.inject({method:'POST',url:'/api/projects',headers:headers(),payload:{name:'Isolated coding fixture',description:'A small module'}});expect(project.statusCode).toBe(201);projectId=project.json().id;
  },30000);
  afterAll(async()=>{await app?.close();if(db){await db.auditEvent.deleteMany({where:{userId:{in:userIds}}});await db.user.deleteMany({where:{id:{in:userIds}}});await db.$disconnect();}});
  it('isolates project ownership and rejects unsafe source paths',async()=>{
    expect((await app.inject({url:`/api/projects/${projectId}`,headers:{authorization:`Bearer ${otherToken}`}})).statusCode).toBe(404);
    expect((await app.inject({url:`/api/projects/${projectId}/export`,headers:{authorization:`Bearer ${otherToken}`}})).statusCode).toBe(404);
    for(const path of ['../secret.txt','.git/config','.env','node_modules/pkg/index.js','private.pem']){
      const result=await app.inject({method:'POST',url:`/api/projects/${projectId}/files`,headers:headers(),payload:{files:[{path,content:'source'}]}});expect(result.statusCode).toBe(400);
    }
    const detail=await app.inject({url:`/api/projects/${projectId}`,headers:headers()});expect(detail.json().project.localManifest).toBeUndefined();
  });
  it('imports and edits source using optimistic revisions and a bounded project snapshot',async()=>{
    const imported=await app.inject({method:'POST',url:`/api/projects/${projectId}/files`,headers:headers(),payload:{files:[{path:'src/add.js',content:'export const add = (a,b) => a - b;\n'},{path:'README.md',content:'A small arithmetic module.'}]}});
    expect(imported.statusCode).toBe(200);expect(imported.json().items).toHaveLength(2);
    const edited=await app.inject({method:'POST',url:`/api/projects/${projectId}/files`,headers:headers(),payload:{files:[{path:'README.md',content:'A small arithmetic module. Use node --test.',baseRevision:1}]}});expect(edited.statusCode).toBe(200);
    const stale=await app.inject({method:'POST',url:`/api/projects/${projectId}/files`,headers:headers(),payload:{files:[{path:'README.md',content:'stale',baseRevision:1},{path:'accidental.js',content:'should not persist'}]}});expect(stale.statusCode).toBe(409);
    expect((await files()).some(file=>file.path==='accidental.js')).toBe(false);
    const oversized=await app.inject({method:'POST',url:`/api/projects/${projectId}/files`,headers:headers(),payload:{files:[{path:'large.js',content:'😀'.repeat(30000)}]}});expect(oversized.statusCode).toBe(400);
  });
  it('reads actual source, stages changes, deduplicates requests, and applies only after approval',async()=>{
    outputs=[response([{type:'read_file',path:'src/add.js'}]),response([{type:'write_file',path:'src/add.js',content:'export const add = (a,b) => a + b;\n'},{type:'write_file',path:'add.test.js',content:'// tests to run after approval\n'},{type:'run_command',program:'node',args:['--test']}],true)];
    const requestId=randomUUID();const run=await startRun('Fix the add operation and propose a test.',requestId);const saved=await settled(run.id);
    expect(saved.status).toBe('awaiting_review');expect(JSON.stringify(lastModelMessages)).toContain('a - b');
    const before=(await files()).find(file=>file.path==='src/add.js')!;expect(before.content).toContain('a - b');
    const count=calls;const repeat=await app.inject({method:'POST',url:`/api/projects/${projectId}/runs`,headers:headers(),payload:{requestId,modelId:'test/coder',prompt:'Fix the add operation and propose a test.'}});expect(repeat.statusCode).toBe(200);expect(repeat.json().id).toBe(run.id);expect(calls).toBe(count);
    expect(repeat.json().actions.find((action:any)=>action.type==='write_file').baseFileId).toBeUndefined();
    expect((await app.inject({method:'POST',url:`/api/projects/${projectId}/runs/${run.id}/apply`,headers:{authorization:`Bearer ${otherToken}`},payload:{}})).statusCode).toBe(404);
    const applied=await app.inject({method:'POST',url:`/api/projects/${projectId}/runs/${run.id}/apply`,headers:headers(),payload:{}});expect(applied.statusCode,applied.body).toBe(200);expect(applied.json().status).toBe('applied');
    expect((await files()).find(file=>file.path==='src/add.js')?.content).toContain('a + b');
    expect(await db.codingCommand.count({where:{projectId}})).toBe(0);
    expect((await app.inject({method:'POST',url:`/api/projects/${projectId}/runs/${run.id}/apply`,headers:headers(),payload:{}})).statusCode).toBe(409);
  });
  it('includes bounded recorded command results in the next coding task',async()=>{
    const command=await db.codingCommand.create({data:{projectId,requestId:randomUUID(),program:'node',args:['--test'],status:'error',output:'x'.repeat(5000)+'\nRecorded assertion failure'}});
    try {
      outputs=[response([],true,'Reviewed the recorded test failure.')];
      const run=await startRun('Explain the latest test failure.');expect((await settled(run.id)).status).toBe('complete');
      const context=JSON.parse(lastModelMessages[1].content);
      expect(context.recentCommandResults).toHaveLength(1);
      expect(context.recentCommandResults[0]).toMatchObject({program:'node',args:['--test'],status:'error'});
      expect(context.recentCommandResults[0].output).toHaveLength(4000);
      expect(context.recentCommandResults[0].output).toContain('Recorded assertion failure');
    } finally {await db.codingCommand.delete({where:{id:command.id}});}
  });
  it('rejects stale apply atomically without writing any other proposed file',async()=>{
    outputs=[response([{type:'read_file',path:'src/add.js'}]),response([{type:'write_file',path:'new-module.js',content:'export const answer = 42;\n'},{type:'write_file',path:'src/add.js',content:'export function add(a,b){ return a+b; }\n'}],true)];
    const run=await startRun('Refactor the module.');await settled(run.id);const original=(await files()).find(file=>file.path==='src/add.js')!;
    expect((await app.inject({method:'POST',url:`/api/projects/${projectId}/files`,headers:headers(),payload:{files:[{path:original.path,content:original.content+'// concurrent edit\n',baseRevision:original.revision}]}})).statusCode).toBe(200);
    const applied=await app.inject({method:'POST',url:`/api/projects/${projectId}/runs/${run.id}/apply`,headers:headers(),payload:{}});expect(applied.statusCode).toBe(409);expect(applied.json().error.code).toBe('REVISION_CONFLICT');
    expect((await files()).some(file=>file.path==='new-module.js')).toBe(false);expect((await files()).find(file=>file.path===original.path)?.content).toContain('concurrent edit');
  });
  it('detects deletion and recreation of a file even when its numeric revision is reused',async()=>{
    await app.inject({method:'POST',url:`/api/projects/${projectId}/files`,headers:headers(),payload:{files:[{path:'temporary.js',content:'original'}]}});
    outputs=[response([{type:'read_file',path:'temporary.js'}]),response([{type:'write_file',path:'temporary.js',content:'proposal'}],true)];
    const run=await startRun('Update temporary file.');await settled(run.id);
    await app.inject({method:'DELETE',url:`/api/projects/${projectId}/files`,headers:headers(),payload:{path:'temporary.js',baseRevision:1}});
    await app.inject({method:'POST',url:`/api/projects/${projectId}/files`,headers:headers(),payload:{files:[{path:'temporary.js',content:'replacement'}]}});
    expect((await app.inject({method:'POST',url:`/api/projects/${projectId}/runs/${run.id}/apply`,headers:headers(),payload:{}})).statusCode).toBe(409);
    expect((await files()).find(file=>file.path==='temporary.js')?.content).toBe('replacement');
  });
  it('cancels a running model request without applying project changes',async()=>{
    pause=true;let started!:()=>void;const startedPromise=new Promise<void>(resolve=>{started=resolve;});modelStarted=started;
    const run=await startRun('Wait for cancellation.');await startedPromise;
    const cancelled=await app.inject({method:'POST',url:`/api/projects/${projectId}/runs/${run.id}/cancel`,headers:headers(),payload:{}});expect(cancelled.statusCode).toBe(200);
    expect((await settled(run.id)).status).toBe('cancelled');pause=false;modelStarted=undefined;
  });
  it('rejects malformed model JSON and never applies guessed file changes',async()=>{
    outputs=['I changed your project successfully!'];const before=(await files()).map(file=>file.content);const run=await startRun('Return invalid JSON.');
    const failed=await settled(run.id);expect(failed.status).toBe('error');expect(failed.error).toContain('required coding action format');expect((await files()).map(file=>file.content)).toEqual(before);
  });
  it('does not report success for rejected unsafe actions on a done response',async()=>{
    outputs=Array.from({length:8},()=>response([{type:'write_file',path:'../outside.js',content:'unsafe'}],true,'Finished successfully.'));
    const run=await startRun('Attempt unsafe paths.');const failed=await settled(run.id);expect(failed.status).toBe('error');expect(failed.error).toContain('could not prepare a valid change');expect(failed.summary).toContain('rejected');
  });
});
