import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { validateProjectPath, validateProjectFiles } from '@omnichat/core';
import type { CodingAction, CodingProject, CodingFile, CodingRun } from '@omnichat/types';
import type { PrismaClient } from '@omnichat/database';
import type { Context } from './app.js';
import { authenticate, HttpError } from './security.js';
import { runCodingAgent } from './coding-agent.js';

const projectParams=z.object({id:z.string().uuid()});
const runParams=projectParams.extend({runId:z.string().uuid()});
export const codingProject=(row:any):CodingProject=>({id:row.id,name:row.name,description:row.description,source:row.source??'imported',localPath:row.localPath??null,createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString()});
export const codingFile=(row:any):CodingFile=>({id:row.id,path:row.path,content:row.content,revision:row.revision,updatedAt:row.updatedAt.toISOString()});
export const codingRun=(row:any):CodingRun=>({id:row.id,projectId:row.projectId,requestId:row.requestId,prompt:row.prompt,modelId:row.modelId,status:row.status,summary:row.summary,actions:row.actions.map(({baseFileId:_,...action}:any)=>action),error:row.error,createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString()});
export async function ownedProject(db:PrismaClient,id:string,userId:string){const project=await db.codingProject.findFirst({where:{id,userId}});if(!project)throw new HttpError(404,'NOT_FOUND','Coding project not found.');return project;}
function safePath(path:string){try{return validateProjectPath(path);}catch(error){throw new HttpError(400,'INVALID_PATH',error instanceof Error?error.message:'Invalid project path.');}}
function safeFiles(files:{path:string;content:string}[]){try{validateProjectFiles(files);}catch(error){throw new HttpError(400,'PROJECT_LIMIT',error instanceof Error?error.message:'Project file limits were exceeded.');}}
const storedActions=z.array(z.discriminatedUnion('type',[
  z.object({type:z.literal('write_file'),path:z.string(),content:z.string(),baseRevision:z.number().int().positive().nullable(),baseFileId:z.string().uuid().nullable().optional()}),
  z.object({type:z.literal('delete_file'),path:z.string(),baseRevision:z.number().int().positive(),baseFileId:z.string().uuid().optional()}),
  z.object({id:z.string().optional(),type:z.literal('run_command'),program:z.enum(['node','npm','pnpm']),args:z.array(z.string())}),
]));

export function registerCoding(app:FastifyInstance,ctx:Context){
  const {db,gateway,active}=ctx;const running=new Set<Promise<void>>();
  app.addHook('onClose',async()=>{for(const [key,controller] of active)if(key.startsWith('coding:'))controller.abort();await Promise.allSettled([...running]);});
  app.get('/api/projects',async request=>{const {userId}=await authenticate(request,db);return {items:(await db.codingProject.findMany({where:{userId},orderBy:{updatedAt:'desc'},take:100})).map(codingProject)};});
  app.post('/api/projects',async(request,reply)=>{const {userId}=await authenticate(request,db);const body=z.object({name:z.string().trim().min(1).max(100),description:z.string().max(2000).default('')}).strict().parse(request.body);const row=await db.codingProject.create({data:{userId,...body}});await db.auditEvent.create({data:{userId,action:'coding.project.create'}});return reply.status(201).send(codingProject(row));});
  app.get('/api/projects/:id',async request=>{const {userId}=await authenticate(request,db);const {id}=projectParams.parse(request.params);const project=await ownedProject(db,id,userId);const [files,runs]=await Promise.all([db.codingFile.findMany({where:{projectId:id},orderBy:{path:'asc'}}),db.codingRun.findMany({where:{projectId:id},orderBy:{createdAt:'desc'},take:30})]);return {project:codingProject(project),files:files.map(codingFile),runs:runs.map(codingRun)};});
  app.post('/api/projects/:id/files',{bodyLimit:3*1024*1024},async request=>{
    const {userId}=await authenticate(request,db);const {id}=projectParams.parse(request.params);await ownedProject(db,id,userId);
    const body=z.object({files:z.array(z.object({path:z.string().max(240),content:z.string().max(102400),baseRevision:z.number().int().positive().nullable().optional()}).strict()).min(1).max(200)}).strict().parse(request.body);
    const changes=body.files.map(file=>({...file,path:safePath(file.path)}));if(new Set(changes.map(file=>file.path)).size!==changes.length)throw new HttpError(400,'DUPLICATE_PATH','Each imported file path must be unique.');
    const files=await db.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
      const existing=await tx.codingFile.findMany({where:{projectId:id}});const mapped=new Map(existing.map(file=>[file.path,{path:file.path,content:file.content}]));
      for(const change of changes){const old=existing.find(file=>file.path===change.path);if(old?change.baseRevision!==old.revision:change.baseRevision!=null)throw new HttpError(409,'REVISION_CONFLICT',`${change.path} changed since you read it. Reload before saving.`);mapped.set(change.path,change);}
      safeFiles([...mapped.values()]);
      for(const change of changes){const old=existing.find(file=>file.path===change.path);if(old)await tx.codingFile.update({where:{id:old.id},data:{content:change.content,revision:{increment:1}}});else await tx.codingFile.create({data:{projectId:id,path:change.path,content:change.content}});}
      await tx.codingProject.update({where:{id},data:{updatedAt:new Date()}});return tx.codingFile.findMany({where:{projectId:id},orderBy:{path:'asc'}});
    });return {items:files.map(codingFile)};
  });
  app.delete('/api/projects/:id/files',async request=>{
    const {userId}=await authenticate(request,db);const {id}=projectParams.parse(request.params);await ownedProject(db,id,userId);const body=z.object({path:z.string().max(240),baseRevision:z.number().int().positive()}).strict().parse(request.body);const path=safePath(body.path);
    await db.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;const removed=await tx.codingFile.deleteMany({where:{projectId:id,path,revision:body.baseRevision}});if(!removed.count)throw new HttpError(409,'REVISION_CONFLICT','The file changed or was removed. Reload before deleting.');await tx.codingProject.update({where:{id},data:{updatedAt:new Date()}});});return {ok:true};
  });
  app.get('/api/projects/:id/export',async(request,reply)=>{const {userId}=await authenticate(request,db);const {id}=projectParams.parse(request.params);const project=await ownedProject(db,id,userId);const files=await db.codingFile.findMany({where:{projectId:id},select:{path:true,content:true},orderBy:{path:'asc'}});return reply.header('Content-Disposition','attachment; filename="omnichat-project.json"').header('Cache-Control','private, no-store').send({project:codingProject(project),files});});
  app.get('/api/projects/:id/runs',async request=>{const {userId}=await authenticate(request,db);const {id}=projectParams.parse(request.params);await ownedProject(db,id,userId);return {items:(await db.codingRun.findMany({where:{projectId:id},orderBy:{createdAt:'desc'},take:50})).map(codingRun)};});
  app.post('/api/projects/:id/runs',{config:{rateLimit:{max:10,timeWindow:60000}}},async(request,reply)=>{
    const {userId}=await authenticate(request,db);const {id}=projectParams.parse(request.params);const project=await ownedProject(db,id,userId);const body=z.object({requestId:z.string().uuid(),modelId:z.string().min(1).max(300),prompt:z.string().trim().min(1).max(12000)}).strict().parse(request.body);
    const previous=await db.codingRun.findUnique({where:{projectId_requestId:{projectId:id,requestId:body.requestId}}});if(previous){if(previous.prompt!==body.prompt||previous.modelId!==body.modelId)throw new HttpError(409,'REQUEST_CONFLICT','This request ID was used for another coding task.');return codingRun(previous);}
    const registry=await gateway.discover();const model=registry.models.find(item=>item.id===body.modelId);if(!model?.capabilities.chat)throw new HttpError(409,'MODEL_UNAVAILABLE','Choose a discovered chat model for the coding agent.');
    const result=await db.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;if(await tx.codingRun.count({where:{projectId:id,status:'running'}}))throw new HttpError(409,'RUN_ACTIVE','A coding run is already active in this project.');const files=await tx.codingFile.findMany({where:{projectId:id},orderBy:{path:'asc'}});const run=await tx.codingRun.create({data:{projectId:id,...body,status:'running',summary:'Inspecting project files.'}});return {files,run};});
    const controller=new AbortController();const key=`coding:${result.run.id}`;active.set(key,controller);
    const commandResults=(await db.codingCommand.findMany({where:{projectId:id,status:{in:['complete','error','cancelled']}},orderBy:{createdAt:'desc'},take:3,select:{program:true,args:true,status:true,output:true}})).map(command=>({...command,output:command.output.slice(-4000)}));
    const task=runCodingAgent({db,gateway,runId:result.run.id,projectName:project.name,description:project.description,prompt:body.prompt,model,files:result.files,commandResults,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(300000)])});
    running.add(task);void task.catch(()=>{}).finally(()=>{running.delete(task);if(active.get(key)===controller)active.delete(key);});
    return reply.status(202).send(codingRun(result.run));
  });
  const ownedRun=async(request:any)=>{const {userId}=await authenticate(request,db);const {id,runId}=runParams.parse(request.params);await ownedProject(db,id,userId);const run=await db.codingRun.findFirst({where:{id:runId,projectId:id}});if(!run)throw new HttpError(404,'NOT_FOUND','Coding run not found.');return {userId,id,runId,run};};
  app.post('/api/projects/:id/runs/:runId/cancel',async request=>{const {runId}=await ownedRun(request);active.get(`coding:${runId}`)?.abort();await db.codingRun.updateMany({where:{id:runId,status:'running'},data:{status:'cancelled',error:'The coding run was cancelled. No changes were applied.'}});return {ok:true};});
  app.post('/api/projects/:id/runs/:runId/reject',async request=>{const {userId,runId}=await ownedRun(request);const changed=await db.codingRun.updateMany({where:{id:runId,status:'awaiting_review'},data:{status:'rejected'}});if(!changed.count)throw new HttpError(409,'RUN_STATE','Only a completed proposal awaiting review can be rejected.');await db.auditEvent.create({data:{userId,action:'coding.run.reject'}});return {ok:true};});
  app.post('/api/projects/:id/runs/:runId/apply',async request=>{
    const {userId,id,runId}=await ownedRun(request);z.object({}).strict().parse(request.body??{});
    const run=await db.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
      const current=await tx.codingRun.findUniqueOrThrow({where:{id:runId}});if(current.status!=='awaiting_review')throw new HttpError(409,'RUN_STATE','This run is not awaiting review.');
      const actions=storedActions.parse(current.actions);
      const existing=await tx.codingFile.findMany({where:{projectId:id}});const mapped=new Map(existing.map(file=>[file.path,{path:file.path,content:file.content}]));const seen=new Set<string>();
      for(const action of actions){if(action.type==='run_command')continue;const path=safePath(action.path);if(seen.has(path))throw new HttpError(409,'INVALID_PROPOSAL','A file has multiple conflicting proposals.');seen.add(path);const old=existing.find(file=>file.path===path);const replaced=action.baseFileId!==undefined && (old?.id??null)!==action.baseFileId;if(replaced || (old?old.revision!==action.baseRevision:action.baseRevision!==null))throw new HttpError(409,'REVISION_CONFLICT',`${path} changed after the agent read it. Start a new run to rebase the change.`);if(action.type==='delete_file'){if(!old)throw new HttpError(409,'REVISION_CONFLICT',`${path} no longer exists.`);mapped.delete(path);}else mapped.set(path,{path,content:action.content});}
      safeFiles([...mapped.values()]);
      for(const action of actions){if(action.type==='run_command')continue;const old=existing.find(file=>file.path===action.path);if(action.type==='delete_file')await tx.codingFile.delete({where:{id:old!.id}});else if(old)await tx.codingFile.update({where:{id:old.id},data:{content:action.content,revision:{increment:1}}});else await tx.codingFile.create({data:{projectId:id,path:action.path,content:action.content}});}
      await tx.codingProject.update({where:{id},data:{updatedAt:new Date()}});await tx.auditEvent.create({data:{userId,action:'coding.run.apply'}});return tx.codingRun.update({where:{id:runId},data:{status:'applied'}});
    });return codingRun(run);
  });
}
