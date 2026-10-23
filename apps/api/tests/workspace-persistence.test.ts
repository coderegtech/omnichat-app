import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {link,mkdir,readFile,realpath,rename,rm,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join,resolve} from 'node:path';
import {buildApp,type Context} from '../src/app.js';
import {WorkspaceSession,runApprovedCommand,streamingMessage} from '../src/workspace-agent.js';
import {redactWorkspaceText} from '../src/workspace-redact.js';
import {WorkspaceStore} from '../src/workspace-store.js';
import {gitCommand,mutateGit} from '../src/workspace-git.js';
import {WorkspaceSandbox,workspaceProcessEnv} from '../src/workspace-sandbox.js';
import {WorkspaceTerminal} from '../src/workspace-terminal.js';
import type {FastifyInstance} from 'fastify';
import type {Model} from '@omnichat/types';

const model:Model={id:'fixture/chat',name:'Fixture',provider:'fixture',capabilities:{chat:true},availability:'available',metadataSource:'gateway'};
const token='a'.repeat(43);const userId=randomUUID();const email='workspace@example.test';
let base:string,root:string,app:FastifyInstance;
const config={host:'127.0.0.1',port:0,origins:['http://localhost:3210'],cookieSecure:false,sessionDays:1,uploadDir:'',gatewayUrl:'http://localhost:1',allowNoAuth:false,overrides:{}};
const db={session:{findUnique:vi.fn(async()=>({userId,user:{id:userId,email},expiresAt:new Date(Date.now()+3600000)}))},auditEvent:{create:vi.fn(async()=>({}))}} as unknown as Context['db'];
const gateway={discover:async()=>({models:[model]}),async *chat(){yield {text:JSON.stringify({message:'Read only response',done:true,actions:[]})};}} as unknown as Context['gateway'];
const request=(url:string,method:'GET'|'POST'|'PATCH'|'PUT'|'DELETE'='GET',payload?:unknown)=>app.inject({url:'/api/workspace'+url,method,headers:{authorization:`Bearer ${token}`},...(payload?{payload:payload as object}:{})});
const start=()=>buildApp({db,gateway,config,logger:false});
beforeEach(async()=>{
  base=resolve('work','workspace-persistence',randomUUID());root=join(base,'source');
  await mkdir(root,{recursive:true});root=await realpath(root);await writeFile(join(root,'a.ts'),'export const a = 1;\n');
  config.uploadDir=join(base,'application');
  vi.stubEnv('CODING_LOCAL_PROJECTS',JSON.stringify([{email,path:base}]));vi.stubEnv('CODING_WORKSPACE_COMMANDS','false');
  app=await start();
});
afterEach(async()=>{await app.close();vi.unstubAllEnvs();await rm(base,{recursive:true,force:true});});

describe('durable direct workspaces',()=>{
  it('keeps separate chats and project settings after restart without copying source files',async()=>{
    const first=await request('/sessions','POST',{path:root});expect(first.statusCode).toBe(201);const id=first.json().id;
    expect((await request('/sessions','POST',{path:root+'/.'})).json().id).toBe(id);
    const second=(await request('/sessions','POST',{path:root,newChat:true})).json();expect(second.id).not.toBe(id);
    expect((await request(`/sessions/${id}`,'PATCH',{name:'Renamed',title:'Architecture',mode:'plan',memory:'Run the tests',modelId:model.id,pinned:true})).statusCode).toBe(200);
    expect((await request(`/sessions/${second.id}`)).json().memory).toBe('Run the tests');
    const turn=await request(`/sessions/${id}/messages`,'POST',{modelId:model.id,prompt:'Explain the project'});expect(turn.statusCode).toBe(200);
    await app.close();app=await start();
    const restored=(await request(`/sessions/${id}`)).json();
    expect(restored).toMatchObject({name:'Renamed',title:'Architecture',mode:'plan',modelId:model.id,pinned:true,memory:'Run the tests'});
    expect(restored.transcript.some((event:{type:string})=>event.type==='assistant')).toBe(true);
    expect((await request('/sessions')).json().items).toHaveLength(2);
    expect(await readFile(join(root,'a.ts'),'utf8')).toBe('export const a = 1;\n');
    expect((await request(`/sessions/${id}/file`,'POST',{path:'a.ts',before:'export const a = 1;\n',after:'bad'})).statusCode).toBe(403);
    expect((await request(`/sessions/${id}/terminals`,'POST',{shell:'cmd',approved:true})).statusCode).toBe(403);
  });
  it('retains missing folders for relinking and rechecks authorization after restart',async()=>{
    const id=(await request('/sessions','POST',{path:root})).json().id;
    await app.close();await rename(root,join(base,'moved'));app=await start();
    expect((await request(`/sessions/${id}`)).statusCode).toBe(404);
    expect((await request('/sessions')).json().items).toHaveLength(1);
    expect((await request(`/sessions/${id}`,'PATCH',{path:join(base,'moved')})).statusCode).toBe(200);
    await app.close();vi.stubEnv('CODING_LOCAL_PROJECTS','[]');app=await start();
    expect((await request(`/sessions/${id}`)).statusCode).toBe(403);
    expect((await request(`/sessions/${id}`,'DELETE')).statusCode).toBe(200);
    expect(await readFile(join(base,'moved','a.ts'),'utf8')).toContain('export const a');
  });
  it('isolates saved chats by authenticated owner and rejects invalid mutations',async()=>{
    const id=(await request('/sessions','POST',{path:root})).json().id;
    const other=randomUUID();
    vi.mocked(db.session.findUnique).mockResolvedValueOnce({userId:other,user:{email:'other@example.test'},expiresAt:new Date(Date.now()+3600000)} as never);
    expect((await request(`/sessions/${id}`)).statusCode).toBe(404);
    expect((await request(`/sessions/${id}/git`,'POST',{action:'push'})).statusCode).toBe(400);
    expect((await request(`/sessions/${id}/file?path=../outside`)).statusCode).toBe(400);
    expect((await request(`/sessions/${id}/file`,'POST',{path:'a.ts',before:'stale',after:'replacement'})).statusCode).toBe(409);
  });
  it.each(['ask','plan','review'] as const)('enforces %s mode against model-generated mutations',async mode=>{
    const session=await WorkspaceSession.bind({userId,root,commandsEnabled:true});session.mode=mode;
    await session.runTurn({model,prompt:'change it',signal:new AbortController().signal,chat:async function*(){yield {text:JSON.stringify({actions:[{tool:'write_file',path:'new.ts',content:'bad'}]})};}});
    expect(session.view().pending).toHaveLength(0);
    expect(session.history.at(-1)?.content).toContain('READ_ONLY_MODE');
  });
  it('restores pending proposals with stale-file detection and never replays interrupted commands',async()=>{
    const session=await WorkspaceSession.bind({userId,root,commandsEnabled:true});
    await session.runTurn({model,prompt:'create',signal:new AbortController().signal,chat:async function*(){yield {text:JSON.stringify({actions:[{tool:'write_file',path:'new.ts',content:'new'}]})};}});
    const store=new WorkspaceStore(join(base,'state'));await store.save(session);
    const restored=await WorkspaceSession.restore((await store.read(userId,session.id))!,true);
    await writeFile(join(root,'new.ts'),'external');
    expect((await restored.decideChange(restored.view().pending[0]!.id,true)).status).toBe('failed');
    const command=await WorkspaceSession.bind({userId,root,commandsEnabled:true});await command.proposeCommand('npm',['test']);command.running=new AbortController();
    const interrupted=await WorkspaceSession.restore(command.snapshot(),true);
    expect(interrupted.hasPending).toBe(false);expect(interrupted.view().transcript.at(-1)).toEqual({type:'done',reason:'stopped'});
  });
  it('rechecks deny rules when a previously proposed change is approved',async()=>{
    const session=await WorkspaceSession.bind({userId,root,commandsEnabled:true});
    const pending=await session.proposeCommand('npm',['test']);
    session.rules=[{id:'deny-command',effect:'deny',action:'command',pattern:'npm'}];
    expect(await session.decideChange(pending.id,true)).toMatchObject({status:'failed',error:expect.stringContaining('Denied')});
    expect(session.running).toBeNull();
  });
  it('rejects a concurrent stale edit from another chat instead of overwriting it',async()=>{
    const first=await WorkspaceSandbox.open(root);const second=await WorkspaceSandbox.open(root);
    const before=await readFile(join(root,'a.ts'),'utf8');
    const results=await Promise.allSettled([first.apply({path:'a.ts',before,after:'first'}),second.apply({path:'a.ts',before,after:'second'})]);
    expect(results.filter(item=>item.status==='fulfilled')).toHaveLength(1);
    expect(results.find(item=>item.status==='rejected')).toMatchObject({reason:{code:'CONFLICT'}});
  });
});

describe('local execution',()=>{
  it('excludes service credentials and refuses hard-linked instruction files',async()=>{
    vi.stubEnv('DATABASE_URL','private-database');vi.stubEnv('OPENAI_API_KEY','private-key');
    expect(workspaceProcessEnv()).not.toHaveProperty('DATABASE_URL');expect(workspaceProcessEnv()).not.toHaveProperty('OPENAI_API_KEY');
    await link(join(root,'a.ts'),join(root,'AGENTS.md'));
    expect(await (await WorkspaceSandbox.open(root)).loadInstructions()).toBeNull();
  });
  it('streams only the top-level message, waits for complete escapes, and redacts known secrets',()=>{
    expect(streamingMessage('{"message":"Hello')).toBe('Hello');
    expect(streamingMessage('{"message":"Hello\\nworld","actions":[')).toBe('Hello\nworld');
    expect(streamingMessage('{"actions":[{"message":"not a user message"}]}')).toBe('');
    expect(streamingMessage('{"message":"Hi\\u00')).toBe('Hi');
    expect(redactWorkspaceText('API_KEY=sk-12345678901234567890')).not.toContain('12345678901234567890');
  });
  it('streams output and cancels a running command',async()=>{
    await writeFile(join(root,'wait.cjs'),"console.log('started');setInterval(()=>{},1000);");
    const controller=new AbortController();const chunks:string[]=[];
    const result=await runApprovedCommand(root,'node',['wait.cjs'],controller.signal,output=>{chunks.push(output);controller.abort();});
    expect(chunks.join('')).toContain('started');expect(result.exitCode).not.toBe(0);
  });
  it('runs a native terminal in the project folder and supports interruption and cleanup',async()=>{
    const terminal=await WorkspaceTerminal.open(randomUUID(),root,process.platform==='win32'?'cmd':'sh');
    try{
      terminal.write('echo omnichat-pty-smoke');
      await vi.waitFor(()=>expect(terminal.view().output).toContain('omnichat-pty-smoke'),{timeout:7000});
      terminal.resize(90,30);terminal.interrupt();
    }finally{await terminal.close();}
    expect(terminal.closed).toBe(true);
  });
  it('stages and commits an explicit file, blocks secrets and protects dirty branches',async()=>{
    await gitCommand(root,['init']);await gitCommand(root,['config','user.name','Workspace Test']);await gitCommand(root,['config','user.email','fixture@example.test']);
    const sandbox=await WorkspaceSandbox.open(root);
    await mutateGit(sandbox,{action:'stage',value:'a.ts',approved:true});
    await mutateGit(sandbox,{action:'commit',value:'Initial fixture',approved:true});
    expect(await sandbox.git('log')).toContain('Initial fixture');
    const before=(await gitCommand(root,['rev-parse','HEAD'])).trim();
    await writeFile(join(root,'a.ts'),'export const a = 2;\n');await mutateGit(sandbox,{action:'stage',value:'a.ts',approved:true});await mutateGit(sandbox,{action:'commit',value:'Second fixture',approved:true});
    expect(await sandbox.git('compare',undefined,undefined,before)).toContain('+export const a = 2;');
    await writeFile(join(root,'.env'),'TOKEN=fixture');
    await expect(mutateGit(sandbox,{action:'stage',value:'.env',approved:true})).rejects.toMatchObject({code:'PERMISSION_DENIED'});
    await writeFile(join(root,'a.ts'),'changed');
    await expect(mutateGit(sandbox,{action:'create-branch',value:'feature',approved:true})).rejects.toMatchObject({code:'CONFLICT'});
  });
});
