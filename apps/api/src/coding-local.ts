import type {FastifyInstance} from 'fastify';
import {createHash, randomUUID} from 'node:crypto';
import {lstat, realpath, readdir, readFile, writeFile, rename, unlink, mkdir} from 'node:fs/promises';
import {basename, dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {z} from 'zod';
import {validateProjectFiles, validateProjectPath, CODING_MAX_FILE_BYTES, CODING_MAX_FILES} from '@omnichat/core';
import type {Prisma} from '@omnichat/database';
import type {Context} from './app.js';
import {authenticate, HttpError} from './security.js';
import {codingProject, codingFile, codingRun, ownedProject} from './coding.js';

type SourceFile = {path:string;content:string};
type Manifest = Record<string,string>;
type Change = {path:string;operation:'create'|'update'|'delete';before:string|null;after:string|null};
const params = z.object({id:z.string().uuid()});
const rootSchema = z.array(z.object({email:z.string().email(),path:z.string().min(1),label:z.string().optional()}).strict()).max(50);
const ignored = new Set(['.git','.hg','.svn','node_modules','.next','.expo','.turbo','dist','build','coverage','release','.venv','venv','__pycache__']);
const sha = (value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const within = (root:string,path:string)=>{const rel=relative(root,path);return rel===''||(!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel));};
const conflict = (path:string)=>new HttpError(409,'LOCAL_CONFLICT',path+' changed on disk. Export your workspace to preserve edits, then sync the folder before publishing.');
const missing = (error:unknown)=>(error as NodeJS.ErrnoException).code==='ENOENT';
function manifest(files:SourceFile[]):Manifest {return Object.fromEntries(files.map(file=>[file.path,sha(file.content)]));}
function configRoots(email:string) {
  try {return rootSchema.parse(JSON.parse(process.env.CODING_LOCAL_PROJECTS||'[]')).filter(item=>item.email.toLowerCase()===email.toLowerCase());}
  catch {throw new HttpError(503,'LOCAL_CONFIG','The local-folder access configuration is invalid. Ask the API operator to check CODING_LOCAL_PROJECTS.');}
}
export async function allowedRoots(email:string) {
  const entries=[];
  for(const item of configRoots(email)) {
    if(!isAbsolute(item.path))continue;
    try {const path=await realpath(item.path);if((await lstat(path)).isDirectory())entries.push({path,label:item.label||basename(path)||path});}catch {/* Missing configured roots are unavailable. */}
  }
  return entries;
}

/** Refuse symlinks/junctions and hardlinks; all source access stays inside an explicitly assigned root. */
async function safeTarget(root:string,path:string,allowMissing=false) {
  validateProjectPath(path);
  if(await realpath(root)!==root)throw new HttpError(409,'LOCAL_ROOT_CHANGED','The linked folder moved or was replaced. Link it again.');
  const segments=path.split('/');let current=root;
  for(let i=0;i<segments.length;i++) {
    current=join(current,segments[i]!);
    if(!within(root,current))throw new HttpError(400,'INVALID_PATH','The source path leaves its project.');
    try {
      const stat=await lstat(current);
      if(stat.isSymbolicLink()||(i<segments.length-1&&!stat.isDirectory())||(i===segments.length-1&&(!stat.isFile()||stat.nlink>1))) {
        throw new HttpError(409,'UNSAFE_LOCAL_PATH','Linked source paths must be regular files without links: '+path);
      }
    } catch(error) {if(allowMissing&&missing(error))return current+(i<segments.length-1?sep+segments.slice(i+1).join(sep):'');throw error;}
  }
  return current;
}
export async function authorizedFolder(path:string,email:string) {
  if(!isAbsolute(path))throw new HttpError(400,'LOCAL_PATH','Choose an absolute folder path on the API computer.');
  let canonical:string;
  try {canonical=await realpath(resolve(path));}catch {throw new HttpError(404,'LOCAL_NOT_FOUND','The local folder could not be found.');}
  const roots=await allowedRoots(email);const root=roots.find(item=>within(item.path,canonical));
  if(!root)throw new HttpError(403,'LOCAL_NOT_ALLOWED','This folder is outside the roots assigned to your account.');
  const rel=relative(root.path,resolve(path));
  if(!within(root.path,resolve(path)))throw new HttpError(403,'LOCAL_NOT_ALLOWED','Use a path inside your configured source root.');
  if(rel) {
    const parts=rel.split(sep);let cursor=root.path;
    for(const part of parts) {
      validateProjectPath(part);cursor=join(cursor,part);
      const stat=await lstat(cursor);
      if(stat.isSymbolicLink()||!stat.isDirectory())throw new HttpError(409,'UNSAFE_LOCAL_PATH','Folder links and junctions cannot be attached.');
    }
  }
  if(!(await lstat(canonical)).isDirectory())throw new HttpError(400,'LOCAL_PATH','Select a folder.');
  return canonical;
}
async function readSource(root:string) {
  const files:SourceFile[]=[];let visited=0;const skipped:string[]=[];
  async function visit(directory:string,prefix='') {
    for(const entry of await readdir(directory,{withFileTypes:true})) {
      if(++visited>5000)throw new HttpError(400,'PROJECT_LIMIT','This folder has too many entries. Link a smaller source folder.');
      const path=prefix?prefix+'/'+entry.name:entry.name;
      try {validateProjectPath(path);}catch {skipped.push(path);continue;}
      if(entry.isSymbolicLink()||ignored.has(entry.name.toLowerCase())||entry.name.startsWith('.omnichat-')){skipped.push(path);continue;}
      if(entry.isDirectory()){await visit(join(directory,entry.name),path);continue;}
      if(!entry.isFile()){skipped.push(path);continue;}
      const target=await safeTarget(root,path);const stat=await lstat(target);
      if(stat.size>CODING_MAX_FILE_BYTES){skipped.push(path);continue;}
      const bytes=await readFile(target);
      let content:string;
      try {content=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch {skipped.push(path);continue;}
      if(content.includes('\0')){skipped.push(path);continue;}
      files.push({path,content});
      if(files.length>CODING_MAX_FILES)throw new HttpError(400,'PROJECT_LIMIT','Link a smaller source folder: at most 200 text files are supported.');
    }
  }
  await visit(root);
  try {validateProjectFiles(files);}catch(error) {throw new HttpError(400,'PROJECT_LIMIT',(error as Error).message);}
  return {files,skipped};
}

async function diskContent(root:string,path:string):Promise<string|null> {
  const target=await safeTarget(root,path,true);
  try {const bytes=await readFile(target);if(bytes.length>CODING_MAX_FILE_BYTES)throw conflict(path);return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}
  catch(error){if(missing(error))return null;if(error instanceof HttpError)throw error;throw conflict(path);}
}
async function preparePublish(root:string,base:Manifest,files:SourceFile[]) {
  validateProjectFiles(files);
  const wanted=new Map(files.map(file=>[file.path,file.content]));
  const changes:Change[]=[];
  for(const path of [...new Set([...Object.keys(base),...wanted.keys()])].sort()) {
    const after=wanted.get(path)??null;
    // Unchanged tracked files are also checked, preventing a later publish from
    // silently treating external edits as a new baseline.
    const before=await diskContent(root,path);
    if(base[path]!==undefined ? before===null||sha(before)!==base[path] : before!==null)throw conflict(path);
    if(before!==after)changes.push({path,operation:before===null?'create':after===null?'delete':'update',before,after});
  }
  return {version:sha(JSON.stringify({root,base,files:files.slice().sort((a,b)=>a.path.localeCompare(b.path))})),changes};
}

/** Atomic per-file replacement. Database transactions serialize app operations;
 * external editors are checked again immediately before each replacement. */
async function replaceFile(root:string,path:string,content:string|null,expected:string|null) {
  const target=await safeTarget(root,path,true);
  if(await diskContent(root,path)!==expected)throw conflict(path);
  if(content===null){await unlink(target);return;}
  await mkdir(dirname(target),{recursive:true});
  await safeTarget(root,path,true);
  const temp=join(dirname(target),'.omnichat-'+randomUUID()+'.tmp');
  const mode=expected===null?0o600:(await lstat(target)).mode;
  try {
    await writeFile(temp,content,{encoding:'utf8',flag:'wx',mode});
    await safeTarget(root,path,true);
    if(await diskContent(root,path)!==expected)throw conflict(path);
    await rename(temp,target);
  } finally {await unlink(temp).catch(()=>{});}
}

export function registerCodingLocal(app:FastifyInstance,{db}:Context) {
  app.get('/api/projects/local-roots',async request=>{
    const {user}=await authenticate(request,db);const items=await allowedRoots(user.email);
    return {items,...(!items.length?{reason:'Assign a source root to your account email in CODING_LOCAL_PROJECTS on the API computer to link local folders.'}:{})};
  });
  app.post('/api/projects/link',async(request,reply)=>{
    const {user,userId}=await authenticate(request,db);
    const body=z.object({path:z.string().min(1).max(1024),name:z.string().trim().min(1).max(100).optional()}).strict().parse(request.body);
    const root=await authorizedFolder(body.path,user.email);const snapshot=await readSource(root);
    // Overlapping source folders would give two independent baselines ownership
    // of the same files. Reject overlap globally without exposing the other owner.
    const project=await db.$transaction(async tx=>{
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))','coding-local-link');
      const linked=await tx.codingProject.findMany({where:{source:'linked'},select:{localPath:true}});
      if(linked.some(row=>row.localPath&&(within(row.localPath,root)||within(root,row.localPath))))throw new HttpError(409,'LOCAL_ALREADY_LINKED','This folder or an overlapping folder is already linked.');
      const row=await tx.codingProject.create({data:{userId,name:body.name||basename(root)||'Local project',source:'linked',localPath:root,localManifest:manifest(snapshot.files),files:{create:snapshot.files}}});
      await tx.auditEvent.create({data:{userId,action:'coding.local.link'}});return row;
    });
    return reply.status(201).send({...codingProject(project),skippedCount:snapshot.skipped.length});
  });
  app.get('/api/projects/:id/publish-preview',async request=>{
    const {user,userId}=await authenticate(request,db);const {id}=params.parse(request.params);
    const project=await ownedProject(db,id,userId);
    if(project.source!=='linked'||!project.localPath)throw new HttpError(409,'NOT_LINKED','This is an imported workspace.');
    const root=await authorizedFolder(project.localPath,user.email);
    const files=await db.codingFile.findMany({where:{projectId:id},select:{path:true,content:true}});
    return preparePublish(root,z.record(z.string().regex(/^[0-9a-f]{64}$/)).parse(project.localManifest),files);
  });
  app.post('/api/projects/:id/publish',async request=>{
    const {user,userId}=await authenticate(request,db);const {id}=params.parse(request.params);
    const body=z.object({approved:z.literal(true),version:z.string().regex(/^[0-9a-f]{64}$/)}).strict().parse(request.body);
    await ownedProject(db,id,userId);
    let awaitingCommit=false;
    try {return await db.$transaction(async tx=>{
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))',id);
      const project=await tx.codingProject.findUniqueOrThrow({where:{id}});
      if(project.source!=='linked'||!project.localPath)throw new HttpError(409,'NOT_LINKED','This is an imported workspace.');
      const root=await authorizedFolder(project.localPath,user.email);
      const files=await tx.codingFile.findMany({where:{projectId:id},select:{path:true,content:true}});
      const review=await preparePublish(root,z.record(z.string().regex(/^[0-9a-f]{64}$/)).parse(project.localManifest),files);
      if(body.version!==review.version)throw new HttpError(409,'REVIEW_CHANGED','The workspace changed after review. Open a fresh publication preview.');
      const applied:Change[]=[];
      try {
        for(const change of review.changes){await replaceFile(root,change.path,change.after,change.before);applied.push(change);}
        await tx.codingProject.update({where:{id},data:{localManifest:manifest(files),updatedAt:new Date()}});
        await tx.auditEvent.create({data:{userId,action:'coding.local.publish'}});
      } catch(error) {
        let failed=false;
        for(const change of applied.reverse()){try {await replaceFile(root,change.path,change.before,change.after);}catch {failed=true;}}
        if(failed)throw new HttpError(409,'LOCAL_PARTIAL','Publishing was interrupted and some files could not be restored because they changed externally. Export the workspace and inspect the folder before syncing.');
        throw error;
      }
      awaitingCommit=applied.length>0;
      return {written:review.changes.filter(change=>change.after!==null).length,deleted:review.changes.filter(change=>change.after===null).length};
    },{timeout:30000});}catch(error){
      // A database acknowledgement can fail after the filesystem is changed.
      // Do not attempt an unguarded rollback: the transaction may have committed.
      if(awaitingCommit)throw new HttpError(409,'LOCAL_PARTIAL','Files were written, but database commit could not be confirmed. Inspect the local folder and export the workspace before syncing. Do not assume the publish was rolled back.');
      throw error;
    }
  });
  app.post('/api/projects/:id/sync',async request=>{
    const {user,userId}=await authenticate(request,db);const {id}=params.parse(request.params);await ownedProject(db,id,userId);
    const project=await db.$transaction(async tx=>{
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))',id);
      const row=await tx.codingProject.findUniqueOrThrow({where:{id}});
      if(row.source!=='linked'||!row.localPath)throw new HttpError(409,'NOT_LINKED','This is an imported workspace.');
      if(await tx.codingRun.count({where:{projectId:id,status:'running'}}))throw new HttpError(409,'RUN_ACTIVE','Stop the active coding run before syncing the folder.');
      const root=await authorizedFolder(row.localPath,user.email);const snapshot=await readSource(root);
      const existing=await tx.codingFile.findMany({where:{projectId:id}});
      await tx.codingFile.deleteMany({where:{projectId:id,path:{notIn:snapshot.files.map(file=>file.path)}}});
      for(const file of snapshot.files) {
        const old=existing.find(item=>item.path===file.path);
        if(old)await tx.codingFile.update({where:{id:old.id},data:{content:file.content,revision:{increment:1}}});
        else await tx.codingFile.create({data:{projectId:id,...file}});
      }
      await tx.codingRun.updateMany({where:{projectId:id,status:'awaiting_review'},data:{status:'rejected',error:'The local folder was synced. Start a new task against the refreshed files.'}});
      await tx.auditEvent.create({data:{userId,action:'coding.local.sync'}});
      return tx.codingProject.update({where:{id},data:{localManifest:manifest(snapshot.files) as Prisma.InputJsonValue,updatedAt:new Date()}});
    },{timeout:30000});
    const [files,runs]=await Promise.all([db.codingFile.findMany({where:{projectId:id},orderBy:{path:'asc'}}),db.codingRun.findMany({where:{projectId:id},orderBy:{createdAt:'desc'},take:30})]);
    return {project:codingProject(project),files:files.map(codingFile),runs:runs.map(codingRun)};
  });
}
