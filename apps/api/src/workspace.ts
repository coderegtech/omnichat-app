import type {FastifyInstance,FastifyRequest} from 'fastify';
import {once} from 'node:events';
import {readdir} from 'node:fs/promises';
import {dirname,isAbsolute,join,relative} from 'node:path';
import {z} from 'zod';
import {encodeSSE} from '@omnichat/core';
import type {WorkspaceEvent} from '@omnichat/types';
import type {Context} from './app.js';
import {authenticate,HttpError} from './security.js';
import {allowedRoots,authorizedFolder} from './coding-local.js';
import {WorkspaceSession} from './workspace-agent.js';
import {IGNORED_DIRECTORIES} from './workspace-permissions.js';
import {SandboxError} from './workspace-sandbox.js';

const SESSIONS_PER_USER=5;
const IDLE_MS=12*60*60*1000;
const status:Record<string,number>={NOT_FOUND:404,PERMISSION_DENIED:403,SECRET_FILE:403,RUN_ACTIVE:409,PENDING_CHANGES:409,NOT_PENDING:409,CONFLICT:409,ROOT_CHANGED:409};
const sessionParams=z.object({id:z.string().uuid()});
const ruleSchema=z.object({id:z.string().min(1).max(64),effect:z.enum(['allow','deny']),action:z.enum(['read','edit','delete','command']),pattern:z.string().trim().min(1).max(200)}).strict();

async function guard<T>(work:()=>Promise<T>):Promise<T> {
  try {return await work();}
  catch(error) {if(error instanceof SandboxError)throw new HttpError(status[error.code]??400,error.code,error.message);throw error;}
}

/** Live local workspace sessions. State is in memory for one API process and is
 * forgotten on restart; files are read from and written to the bound folder only. */
export function registerWorkspace(app:FastifyInstance,{db,gateway}:Context) {
  const sessions=new Map<string,WorkspaceSession>();
  const sweep=setInterval(()=>{for(const [id,session] of sessions)if(!session.running&&Date.now()-session.touchedAt>IDLE_MS)sessions.delete(id);},60*60*1000);sweep.unref();
  app.addHook('onClose',async()=>{clearInterval(sweep);for(const session of sessions.values())session.stop();});
  const owned=async(request:FastifyRequest)=>{
    const auth=await authenticate(request,db);const {id}=sessionParams.parse(request.params);const session=sessions.get(id);
    if(!session||session.userId!==auth.userId)throw new HttpError(404,'NOT_FOUND','Workspace session not found. Bind the folder again.');
    session.touchedAt=Date.now();return {session,email:auth.user.email};
  };
  // Authorization is re-checked before anything that reads or writes on the model's behalf.
  const reauthorize=async(session:WorkspaceSession,email:string)=>{if(await authorizedFolder(session.sandbox.root,email)!==session.sandbox.root)throw new HttpError(409,'ROOT_CHANGED','The project folder moved. Bind it again.');};

  app.get('/api/workspace/roots',async request=>{
    const {user}=await authenticate(request,db);const items=await allowedRoots(user.email);
    return {items,...(!items.length?{reason:'Assign a source root to your account email in CODING_LOCAL_PROJECTS on the API computer to bind local folders.'}:{})};
  });
  app.get('/api/workspace/browse',async request=>{
    const {user}=await authenticate(request,db);const {path}=z.object({path:z.string().min(1).max(1024)}).parse(request.query);
    const folder=await authorizedFolder(path,user.email);const roots=await allowedRoots(user.email);
    const root=roots.find(item=>{const rel=relative(item.path,folder);return !rel.startsWith('..')&&!isAbsolute(rel);});
    const entries=await readdir(folder,{withFileTypes:true});
    const directories=entries.filter(entry=>entry.isDirectory()&&!entry.isSymbolicLink()&&!IGNORED_DIRECTORIES.has(entry.name.toLowerCase())&&!entry.name.startsWith('.')).map(entry=>({name:entry.name,path:join(folder,entry.name)})).sort((a,b)=>a.name.localeCompare(b.name)).slice(0,300);
    const hasInstructions=entries.some(entry=>entry.isFile()&&['CLAUDE.md','AGENTS.md'].includes(entry.name));
    return {path:folder,parent:root&&folder!==root.path?dirname(folder):null,directories,hasInstructions};
  });

  app.get('/api/workspace/sessions',async request=>{const {userId}=await authenticate(request,db);return {items:[...sessions.values()].filter(item=>item.userId===userId).map(item=>({id:item.id,name:item.name,root:item.sandbox.root,createdAt:item.createdAt.toISOString()}))};});
  app.post('/api/workspace/sessions',async(request,reply)=>{
    const {user,userId}=await authenticate(request,db);const body=z.object({path:z.string().min(1).max(1024)}).strict().parse(request.body);
    const root=await authorizedFolder(body.path,user.email);
    const existing=[...sessions.values()].find(item=>item.userId===userId&&item.sandbox.root===root);
    if(existing)return existing.view();
    const mine=[...sessions.values()].filter(item=>item.userId===userId).sort((a,b)=>a.touchedAt-b.touchedAt);
    if(mine.length>=SESSIONS_PER_USER){const oldest=mine.find(item=>!item.running);if(!oldest)throw new HttpError(409,'SESSION_LIMIT','Unbind a project before binding another.');sessions.delete(oldest.id);}
    const session=await guard(()=>WorkspaceSession.bind({userId,root,commandsEnabled:process.env.CODING_WORKSPACE_COMMANDS==='true'}));
    sessions.set(session.id,session);await db.auditEvent.create({data:{userId,action:'workspace.bind'}});
    return reply.status(201).send(session.view());
  });
  app.get('/api/workspace/sessions/:id',async request=>(await owned(request)).session.view());
  app.delete('/api/workspace/sessions/:id',async request=>{const {session}=await owned(request);session.stop();sessions.delete(session.id);return {ok:true};});
  app.put('/api/workspace/sessions/:id/rules',async request=>{const {session}=await owned(request);session.rules=z.object({rules:z.array(ruleSchema).max(50)}).strict().parse(request.body).rules;return {rules:session.rules};});
  app.get('/api/workspace/sessions/:id/tree',async request=>{
    const {session,email}=await owned(request);await reauthorize(session,email);const query=z.object({path:z.string().max(1024).default(''),depth:z.coerce.number().int().min(1).max(2).default(1)}).parse(request.query);
    return guard(()=>session.sandbox.listDir(query.path,query.depth,{includeSecrets:true}));
  });
  app.post('/api/workspace/sessions/:id/context',async request=>{
    const {session,email}=await owned(request);await reauthorize(session,email);const body=z.object({path:z.string().min(1).max(1024),allowSecret:z.boolean().default(false)}).strict().parse(request.body);
    if(session.running)throw new HttpError(409,'RUN_ACTIVE','Wait for the agent to stop before adding files.');
    const file=await guard(()=>session.addContext(body.path,body.allowSecret));
    return {path:file.path,startLine:file.startLine,endLine:file.endLine,totalLines:file.totalLines,truncated:file.truncated};
  });
  app.post('/api/workspace/sessions/:id/stop',async request=>{const {session}=await owned(request);session.stop();return {ok:true};});
  app.post('/api/workspace/sessions/:id/changes/:changeId',async request=>{
    const {session,email}=await owned(request);await reauthorize(session,email);
    const {changeId}=z.object({id:z.string().uuid(),changeId:z.string().uuid()}).parse(request.params);const body=z.object({decision:z.enum(['approve','reject'])}).strict().parse(request.body);
    return guard(()=>session.decideChange(changeId,body.decision==='approve'));
  });
  app.post('/api/workspace/sessions/:id/messages',{config:{rateLimit:{max:20,timeWindow:60_000}}},async(request,reply)=>{
    const {session,email}=await owned(request);await reauthorize(session,email);
    const body=z.object({modelId:z.string().min(1).max(300),prompt:z.string().trim().max(20_000).optional()}).strict().parse(request.body);
    if(session.running)throw new HttpError(409,'RUN_ACTIVE','The agent is already working in this session.');
    if(session.hasPending)throw new HttpError(409,'PENDING_CHANGES','Accept or reject the pending changes first.');
    const registry=await gateway.discover();const model=registry.models.find(item=>item.id===body.modelId);
    if(!model?.capabilities.chat)throw new HttpError(409,'MODEL_UNAVAILABLE','Choose a discovered chat model for the agent.');
    const controller=new AbortController();
    reply.hijack();for(const [key,value] of Object.entries(reply.getHeaders()))if(value!==undefined)reply.raw.setHeader(key,value);
    reply.raw.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
    reply.raw.on('close',()=>{if(!reply.raw.writableEnded)controller.abort();});
    let queue=Promise.resolve();
    const emit=(event:WorkspaceEvent)=>{queue=queue.then(async()=>{if(reply.raw.destroyed||reply.raw.writableEnded)return;if(!reply.raw.write(encodeSSE(event)))await Promise.race([once(reply.raw,'drain'),once(reply.raw,'close')]);});};
    try {
      await session.runTurn({prompt:body.prompt||undefined,model,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(600_000)]),emit,chat:(messages,signal)=>gateway.chat({model:model.id,messages,stream:model.capabilities.streaming!==false},signal)});
    } catch(error) {emit({type:'error',message:error instanceof Error?error.message:'The agent could not start.'});emit({type:'done',reason:'tool_error'});}
    await queue;if(!reply.raw.writableEnded)reply.raw.end();
  });
}
