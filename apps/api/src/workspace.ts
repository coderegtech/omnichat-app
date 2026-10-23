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
import {WorkspaceStore} from './workspace-store.js';
import {decide,IGNORED_DIRECTORIES} from './workspace-permissions.js';
import {SandboxError} from './workspace-sandbox.js';
import {gitAction,mutateGit} from './workspace-git.js';
import {terminalShells,WorkspaceTerminal} from './workspace-terminal.js';

const IDLE_MS=12*60*60*1000;
const status:Record<string,number>={NOT_FOUND:404,PERMISSION_DENIED:403,SECRET_FILE:403,RUN_ACTIVE:409,PENDING_CHANGES:409,NOT_PENDING:409,CONFLICT:409,ROOT_CHANGED:409};
const sessionParams=z.object({id:z.string().uuid()});
const ruleSchema=z.object({id:z.string().min(1).max(64),effect:z.enum(['allow','deny']),action:z.enum(['read','edit','delete','command']),pattern:z.string().trim().min(1).max(200)}).strict();

async function guard<T>(work:()=>Promise<T>):Promise<T> {
  try {return await work();}
  catch(error) {if(error instanceof SandboxError)throw new HttpError(status[error.code]??400,error.code,error.message);throw error;}
}

/** One local companion process owns live operations; application state survives restarts. */
export function registerWorkspace(app:FastifyInstance,{db,gateway,config}:Context) {
  const sessions=new Map<string,WorkspaceSession>();
  const store=new WorkspaceStore(join(config.uploadDir,'workspace-state'));
  const loading=new Map<string,Promise<WorkspaceSession>>();
  const terminals=new Map<string,WorkspaceTerminal>();
  const terminalSweep=setInterval(async()=>{for(const [id,terminal] of terminals)if(Date.now()-terminal.touchedAt>30*60_000){await terminal.close().catch(error=>app.log.error(error));terminals.delete(id);}},60_000);terminalSweep.unref();
  app.addHook('onClose',async()=>{clearInterval(terminalSweep);for(const terminal of terminals.values())await terminal.close();});
  const sweep=setInterval(()=>{for(const [id,session] of sessions)if(!session.running&&Date.now()-session.touchedAt>IDLE_MS)sessions.delete(id);},60*60*1000);sweep.unref();
  app.addHook('onClose',async()=>{clearInterval(sweep);for(const session of sessions.values()){session.stop();await store.save(session);}});
  const load=async(userId:string,email:string,id:string)=>{
    const active=sessions.get(id);if(active?.userId===userId)return active;
    const key=userId+':'+id;const existing=loading.get(key);if(existing)return existing;
    const promise=(async()=>{
      const saved=await store.read(userId,id);if(!saved)throw new HttpError(404,'NOT_FOUND','Workspace chat not found.');
      await authorizedFolder(saved.root,email);
      const session=await guard(()=>WorkspaceSession.restore(saved,process.env.CODING_WORKSPACE_COMMANDS==='true'));
      sessions.set(id,session);return session;
    })();
    loading.set(key,promise);try{return await promise;}finally{loading.delete(key);}
  };
  const owned=async(request:FastifyRequest)=>{
    const auth=await authenticate(request,db);const {id}=sessionParams.parse(request.params);const session=await load(auth.userId,auth.user.email,id);
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

  app.get('/api/workspace/sessions',async request=>{const {userId}=await authenticate(request,db);return {items:await store.list(userId)};});
  app.post('/api/workspace/sessions',async(request,reply)=>{
    const {user,userId}=await authenticate(request,db);const body=z.object({path:z.string().min(1).max(1024),newChat:z.boolean().default(false)}).strict().parse(request.body);
    const root=await authorizedFolder(body.path,user.email);
    const links=await store.list(userId);
    const existing=links.find(item=>process.platform==='win32'?item.root.toLowerCase()===root.toLowerCase():item.root===root);
    if(existing&&!body.newChat)return (await load(userId,user.email,existing.id)).view();
    if(links.length>=200)throw new HttpError(409,'SESSION_LIMIT','Remove an old workspace chat before creating another.');
    const session=await guard(()=>WorkspaceSession.bind({userId,root,commandsEnabled:process.env.CODING_WORKSPACE_COMMANDS==='true'}));
    if(existing){const previous=await load(userId,user.email,existing.id);session.name=previous.name;session.memory=previous.memory;}
    sessions.set(session.id,session);await store.save(session);await db.auditEvent.create({data:{userId,action:'workspace.bind'}});
    return reply.status(201).send(session.view());
  });
  app.get('/api/workspace/sessions/:id',async request=>(await owned(request)).session.view());
  app.delete('/api/workspace/sessions/:id',async request=>{
    const {userId}=await authenticate(request,db);const {id}=sessionParams.parse(request.params);
    const {project}=z.object({project:z.enum(['true','false']).default('false')}).parse(request.query);
    const saved=await store.read(userId,id);if(!saved)throw new HttpError(404,'NOT_FOUND','Chat not found.');
    const ids=project==='true'?(await store.list(userId)).filter(item=>item.root===saved.root).map(item=>item.id):[id];
    if(ids.some(key=>sessions.get(key)?.running))throw new HttpError(409,'RUN_ACTIVE','Stop the active operation before unlinking.');
    for(const id of ids){await store.remove(userId,id);for(const [key,terminal] of terminals)if(terminal.sessionId===id){await terminal.close();terminals.delete(key);}sessions.delete(id);}
    return {ok:true};
  });
  app.patch('/api/workspace/sessions/:id',async request=>{
    const {user,userId}=await authenticate(request,db);const {id}=sessionParams.parse(request.params);
    const body=z.object({path:z.string().min(1).max(1024).optional(),name:z.string().trim().min(1).max(100).optional(),title:z.string().trim().min(1).max(100).optional(),pinned:z.boolean().optional(),mode:z.enum(['ask','plan','agent','review']).optional(),modelId:z.string().max(300).optional(),memory:z.string().max(8000).optional()}).strict().parse(request.body);
    if(sessions.get(id)?.running)throw new HttpError(409,'RUN_ACTIVE','Stop the operation before changing settings.');
    const old=await store.read(userId,id);if(!old)throw new HttpError(404,'NOT_FOUND','Chat not found.');
    const siblings=(await store.list(userId)).filter(item=>item.root===old.root&&item.id!==id);
    if((body.path||body.name||body.memory!==undefined)&&siblings.some(item=>sessions.get(item.id)?.running))throw new HttpError(409,'RUN_ACTIVE','Stop active chats in this project before changing project settings.');
    const nextRoot=body.path?await authorizedFolder(body.path,user.email):old.root;
    if(body.path&&(await store.list(userId)).some(item=>item.root===nextRoot&&item.root!==old.root))throw new HttpError(409,'CONFLICT','That folder is already linked. Select its project instead.');
    if(body.path){
      const saved=await store.read(userId,id);if(!saved)throw new HttpError(404,'NOT_FOUND','Chat not found.');
      const root=await authorizedFolder(body.path,user.email);
      // Relinking invalidates proposals and read context from the previous directory.
      const restored=await guard(()=>WorkspaceSession.restore({...saved,root,pending:[],history:[],interrupted:false},process.env.CODING_WORKSPACE_COMMANDS==='true'));
      for(const [key,terminal] of terminals)if(terminal.sessionId===id){await terminal.close();terminals.delete(key);}sessions.set(id,restored);
    }
    const session=await load(userId,user.email,id);
    if(body.mode&&session.hasPending)throw new HttpError(409,'PENDING_CHANGES','Decide pending changes before switching modes.');
    for(const key of ['name','title','pinned','mode','modelId','memory'] as const)if(body[key]!==undefined)Object.assign(session,{[key]:body[key]});
    if(body.mode&&body.mode!=='agent')for(const [key,terminal] of terminals)if(terminal.sessionId===id){await terminal.close();terminals.delete(key);}
    session.touchedAt=Date.now();await store.save(session);
    if(body.path||body.name||body.memory!==undefined)for(const sibling of siblings){
      const saved=sessions.get(sibling.id)?.snapshot()??await store.read(userId,sibling.id);if(!saved)continue;
      if(body.name)saved.name=body.name;if(body.memory!==undefined)saved.memory=body.memory;
      if(body.path){saved.root=nextRoot;saved.pending=[];saved.history=[];saved.interrupted=false;for(const [key,terminal] of terminals)if(terminal.sessionId===sibling.id){await terminal.close();terminals.delete(key);}}
      await store.saveSnapshot(saved);sessions.delete(sibling.id);
    }
    return session.view();
  });
  app.put('/api/workspace/sessions/:id/rules',async request=>{const {session}=await owned(request);if(session.running)throw new HttpError(409,'RUN_ACTIVE','Stop the operation first.');session.rules=z.object({rules:z.array(ruleSchema).max(50)}).strict().parse(request.body).rules;await store.save(session);return {rules:session.rules};});
  app.get('/api/workspace/sessions/:id/tree',async request=>{
    const {session,email}=await owned(request);await reauthorize(session,email);const query=z.object({path:z.string().max(1024).default(''),depth:z.coerce.number().int().min(1).max(2).default(1)}).parse(request.query);
    return guard(()=>session.sandbox.listDir(query.path,query.depth,{includeSecrets:true}));
  });
  app.post('/api/workspace/sessions/:id/context',async request=>{
    const {session,email}=await owned(request);await reauthorize(session,email);const body=z.object({path:z.string().min(1).max(1024),allowSecret:z.boolean().default(false)}).strict().parse(request.body);
    if(session.running)throw new HttpError(409,'RUN_ACTIVE','Wait for the agent to stop before adding files.');
    const file=await guard(()=>session.addContext(body.path,body.allowSecret));await store.save(session);
    return {path:file.path,startLine:file.startLine,endLine:file.endLine,totalLines:file.totalLines,truncated:file.truncated};
  });
  app.post('/api/workspace/sessions/:id/stop',async request=>{const {session}=await owned(request);session.stop();return {ok:true};});
  app.post('/api/workspace/sessions/:id/changes/:changeId',async request=>{
    const {session,email}=await owned(request);await reauthorize(session,email);
    const {changeId}=z.object({id:z.string().uuid(),changeId:z.string().uuid()}).parse(request.params);const body=z.object({decision:z.enum(['approve','reject']),comment:z.string().trim().max(2000).optional()}).strict().parse(request.body);
    const promise=guard(()=>session.decideChange(changeId,body.decision==='approve'));
    const [result]=await Promise.all([promise,store.save(session)]);
    if(body.comment){const text=`Review comment for ${result.path??result.program}: ${body.comment}`;session.history.push({role:'user',content:text});session.record({type:'user',text});}
    await store.save(session);
    await db.auditEvent.create({data:{userId:session.userId,action:`workspace.${result.kind}.${result.status}`}});
    return result;
  });
  app.get('/api/workspace/sessions/:id/file',async request=>{
    const {session,email}=await owned(request);await reauthorize(session,email);
    const {path}=z.object({path:z.string().min(1).max(1024)}).parse(request.query);
    return guard(async()=>{const {rel}=await session.sandbox.resolve(path);if(decide('read',rel,session.rules).effect==='deny')throw new SandboxError('PERMISSION_DENIED','File read denied.');return session.sandbox.readFile(rel);});
  });
  app.post('/api/workspace/sessions/:id/file',async request=>{
    const {session,email}=await owned(request);await reauthorize(session,email);
    const body=z.object({path:z.string().min(1).max(1024),before:z.string().max(524288),after:z.string().max(524288)}).strict().parse(request.body);
    if(session.running||session.hasPending)throw new HttpError(409,'RUN_ACTIVE','Finish the current operation first.');
    if(session.mode!=='agent')throw new HttpError(403,'READ_ONLY_MODE','File editing requires Agent mode.');
    await guard(async()=>{const {rel}=await session.sandbox.resolve(body.path);if(decide('edit',rel,session.rules).effect==='deny'||decide('read',rel,session.rules).effect==='deny')throw new SandboxError('PERMISSION_DENIED','File editing denied.');await session.sandbox.apply({path:rel,before:body.before,after:body.after});});
    session.record({type:'assistant',text:`Saved ${body.path} after user review.`});await store.save(session);
    await db.auditEvent.create({data:{userId:session.userId,action:'workspace.file.save'}});
    return {ok:true};
  });
  app.get('/api/workspace/sessions/:id/search',async request=>{
    const {session,email}=await owned(request);await reauthorize(session,email);
    const {query}=z.object({query:z.string().min(1).max(200)}).parse(request.query);
    const result=await guard(()=>session.sandbox.searchText(query));
    return {...result,matches:result.matches.filter(item=>decide('read',item.path,session.rules).effect!=='deny')};
  });
  app.get('/api/workspace/sessions/:id/git',async request=>{
    const {session,email}=await owned(request);await reauthorize(session,email);
    const {kind,path,revision}=z.object({kind:z.enum(['status','diff','log','branches','compare']).default('status'),path:z.string().max(1024).optional(),revision:z.string().regex(/^[a-f0-9]{7,40}$/i).optional()}).parse(request.query);
    return {output:await guard(()=>session.sandbox.git(kind,path,path=>decide('read',path,session.rules).effect!=='deny',revision))};
  });
  app.post('/api/workspace/sessions/:id/commands',async request=>{
    const {session,email}=await owned(request);await reauthorize(session,email);
    const body=z.object({program:z.string().max(20),args:z.array(z.string().max(300)).max(24)}).strict().parse(request.body);
    const proposal=await guard(()=>session.proposeCommand(body.program,body.args));await store.save(session);return proposal;
  });
  app.post('/api/workspace/sessions/:id/git',async request=>{
    const {session,email}=await owned(request);await reauthorize(session,email);const body=gitAction.parse(request.body);
    if(!session.commandsEnabled||session.mode!=='agent')throw new HttpError(403,'PERMISSION_DENIED','Git changes require local commands enabled and Agent mode.');
    if(session.running||session.hasPending)throw new HttpError(409,'RUN_ACTIVE','Finish the current operation first.');
    const controller=new AbortController();session.running=controller;await store.save(session);
    try {
      const output=await guard(()=>mutateGit(session.sandbox,body,controller.signal));
      session.record({type:'assistant',text:`Git ${body.action} completed.\n${output}`});
      await db.auditEvent.create({data:{userId:session.userId,action:`workspace.git.${body.action}`}});
      return {output};
    } finally {session.running=null;await store.save(session);}
  });
  app.get('/api/workspace/sessions/:id/terminals',async request=>{
    const {session}=await owned(request);
    return {shells:terminalShells,items:[...terminals.values()].filter(item=>item.sessionId===session.id).map(item=>({id:item.id,shell:item.shell,closed:item.closed}))};
  });
  app.post('/api/workspace/sessions/:id/terminals',async request=>{
    const {session,email}=await owned(request);await reauthorize(session,email);
    const body=z.object({shell:z.string().max(30),approved:z.literal(true)}).strict().parse(request.body);
    if(!session.commandsEnabled||session.mode!=='agent')throw new HttpError(403,'PERMISSION_DENIED','Terminals require local commands enabled and Agent mode.');
    if([...terminals.values()].filter(item=>item.sessionId===session.id).length>=4)throw new HttpError(409,'TERMINAL_LIMIT','Close a terminal before opening another.');
    const terminal=await guard(()=>WorkspaceTerminal.open(session.id,session.sandbox.root,body.shell));terminals.set(terminal.id,terminal);
    await db.auditEvent.create({data:{userId:session.userId,action:'workspace.terminal.open'}});
    return terminal.view();
  });
  const terminalFor=async(request:FastifyRequest)=>{
    const {session,email}=await owned(request);
    const {terminalId}=z.object({terminalId:z.string().uuid()}).parse(request.params);
    const terminal=terminals.get(terminalId);
    if(!terminal||terminal.sessionId!==session.id)throw new HttpError(404,'NOT_FOUND','Terminal not found.');
    return {session,email,terminal};
  };
  app.get('/api/workspace/sessions/:id/terminals/:terminalId',async request=>{
    const {terminal,session,email}=await terminalFor(request);await reauthorize(session,email);
    const {cursor}=z.object({cursor:z.coerce.number().int().min(0).default(0)}).parse(request.query);
    return terminal.view(cursor);
  });
  app.post('/api/workspace/sessions/:id/terminals/:terminalId',async request=>{
    const {terminal,session,email}=await terminalFor(request);await reauthorize(session,email);
    const body=z.discriminatedUnion('action',[
      z.object({action:z.literal('command'),command:z.string().min(1).max(8000),approved:z.literal(true)}).strict(),
      z.object({action:z.literal('resize'),cols:z.number().int().min(10).max(300),rows:z.number().int().min(5).max(150)}).strict(),
      z.object({action:z.literal('interrupt')}).strict(),
    ]).parse(request.body);
    if(!session.commandsEnabled||session.mode!=='agent')throw new HttpError(403,'READ_ONLY_MODE','Terminal input requires Agent mode.');
    if(body.action==='command'){terminal.write(body.command);await db.auditEvent.create({data:{userId:session.userId,action:'workspace.terminal.command'}});}
    else if(body.action==='resize')terminal.resize(body.cols,body.rows);
    else terminal.interrupt();
    return {ok:true};
  });
  app.delete('/api/workspace/sessions/:id/terminals/:terminalId',async request=>{const {terminal}=await terminalFor(request);await terminal.close();terminals.delete(terminal.id);return {ok:true};});
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
      const operation=session.runTurn({prompt:body.prompt||undefined,model,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(600_000)]),emit,chat:(messages,signal)=>gateway.chat({model:model.id,messages,stream:model.capabilities.streaming!==false},signal)});
      await Promise.all([operation,store.save(session)]);await store.save(session);
      await db.auditEvent.create({data:{userId:session.userId,action:'workspace.turn'}});
    } catch(error) {emit({type:'error',message:error instanceof Error?error.message:'The agent could not start.'});emit({type:'done',reason:'tool_error'});}
    await queue;if(!reply.raw.writableEnded)reply.raw.end();
  });
}
