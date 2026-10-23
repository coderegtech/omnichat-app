import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readdir,readFile,rename,unlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import type {WorkspaceLink} from '@omnichat/types';
import {WorkspaceSession,type WorkspaceSnapshot} from './workspace-agent.js';

/** Application state only: never creates files in a linked project. */
export class WorkspaceStore {
  private writes=new Map<string,Promise<void>>();
  constructor(private directory:string){}
  private folder(userId:string){return join(this.directory,createHash('sha256').update(userId).digest('hex'));}
  private path(userId:string,id:string){return join(this.folder(userId),z.string().uuid().parse(id)+'.json');}
  async read(userId:string,id:string):Promise<WorkspaceSnapshot|null> {
    try {
      const text=await readFile(this.path(userId,id),'utf8');
      const data=JSON.parse(text) as WorkspaceSnapshot;
      if(data.version!==1||data.userId!==userId||data.id!==id||!Array.isArray(data.history)||!Array.isArray(data.transcript))throw new Error('Invalid saved workspace state.');
      return data;
    } catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
  }
  async list(userId:string):Promise<WorkspaceLink[]> {
    const files=await readdir(this.folder(userId)).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
    const rows=await Promise.all(files.filter(file=>/^[a-f0-9-]{36}\.json$/.test(file)).map(file=>this.read(userId,file.slice(0,-5))));
    return rows.filter((row):row is WorkspaceSnapshot=>!!row).map(row=>({id:row.id,name:row.name,root:row.root,title:row.title,pinned:row.pinned,modelId:row.modelId,mode:row.mode,updatedAt:new Date(row.touchedAt).toISOString()})).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.updatedAt.localeCompare(a.updatedAt));
  }
  save(session:WorkspaceSession) {
    return this.saveSnapshot(session.snapshot());
  }
  saveSnapshot(snapshot:WorkspaceSnapshot) {
    const file=this.path(snapshot.userId,snapshot.id);const data=JSON.stringify(snapshot);
    const previous=this.writes.get(file)??Promise.resolve();
    const next=previous.catch(()=>{}).then(async()=>{
      await mkdir(this.folder(snapshot.userId),{recursive:true,mode:0o700});
      const temp=file+'.'+randomUUID()+'.tmp';
      try {await writeFile(temp,data,{flag:'wx',mode:0o600});await rename(temp,file);}
      finally {await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
    });
    this.writes.set(file,next);void next.finally(()=>{if(this.writes.get(file)===next)this.writes.delete(file);}).catch(()=>{});
    return next;
  }
  async remove(userId:string,id:string){const file=this.path(userId,id);await this.writes.get(file);await unlink(file);}
}
