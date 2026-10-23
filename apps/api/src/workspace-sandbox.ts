import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {link,lstat,mkdir,readdir,readFile,realpath,rename,stat,unlink,writeFile} from 'node:fs/promises';
import {dirname,isAbsolute,join,relative,sep} from 'node:path';
import type {WorkspaceInstructions,WorkspaceTreeEntry} from '@omnichat/types';
import {globToRegExp,IGNORED_DIRECTORIES,isIgnoredPath,isSecretPath} from './workspace-permissions.js';
import {unifiedDiff} from './workspace-diff.js';
import {redactWorkspaceText} from './workspace-redact.js';

export const READ_MAX_BYTES=512*1024;
export const READ_MAX_CHARS=60_000;
export const READ_MAX_LINES=2000;
export const SEARCH_MAX_HITS=50;
export const LIST_MAX_ENTRIES=400;
export const INSTRUCTIONS_MAX_CHARS=8000;
export const INSTRUCTION_FILES=['CLAUDE.md','AGENTS.md'];
const SEARCH_MAX_FILES=4000;
const WRITE_MAX_BYTES=512*1024;
const writes=new Map<string,Promise<void>>();

export class SandboxError extends Error {constructor(public code:string,message:string){super(message);}}
export function workspaceProcessEnv():Record<string,string> {
  const env:Record<string,string>={};
  for(const [key,value] of Object.entries(process.env))if(value&&/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|TEMP|TMP|LANG|LC_ALL|APPDATA|LOCALAPPDATA)$/i.test(key))env[key]=value;
  return env;
}
export interface PlannedChange {path:string;before:string|null;after:string|null;diff:string;}

const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const within=(root:string,path:string)=>{const rel=relative(root,path);return rel===''||(rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel));};
const missing=(error:unknown)=>['ENOENT','ENOTDIR'].includes((error as NodeJS.ErrnoException).code??'');
function decode(bytes:Buffer,path:string) {
  if(bytes.subarray(0,8192).includes(0))throw new SandboxError('BINARY_FILE',`${path} is a binary file and cannot be read as text.`);
  try {return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}
  catch {throw new SandboxError('BINARY_FILE',`${path} is not valid UTF-8 text.`);}
}
const count=(haystack:string,needle:string)=>{let total=0,index=haystack.indexOf(needle);while(index>=0){total++;index=haystack.indexOf(needle,index+needle.length);}return total;};

/** All tool paths resolve inside one canonical root. Traversal, absolute paths
 * and symlinks/junctions whose real location leaves the root are rejected. */
export class WorkspaceSandbox {
  private constructor(readonly root:string){}
  static async open(path:string) {
    let root:string;
    try {root=await realpath(path);}catch {throw new SandboxError('NOT_FOUND','The project folder could not be found.');}
    if(!(await stat(root)).isDirectory())throw new SandboxError('NOT_DIRECTORY','Choose a folder as the project root.');
    return new WorkspaceSandbox(root);
  }

  /** Returns the canonical project-relative path ('' for the root) and absolute location. */
  async resolve(input:string,options:{allowMissing?:boolean}={}):Promise<{rel:string;abs:string}> {
    const value=(input??'').trim();
    if(value.length>1024||/[\x00-\x1f]/.test(value))throw new SandboxError('INVALID_PATH','The path is too long or contains control characters.');
    if(value.includes('\\'))throw new SandboxError('INVALID_PATH','Use forward slashes in project paths.');
    if(value.startsWith('/')||/^[a-zA-Z]:/.test(value)||isAbsolute(value))throw new SandboxError('PATH_ESCAPE','Absolute paths are not allowed. Use a path relative to the project root.');
    const segments=value.split('/').filter(segment=>segment&&segment!=='.');
    if(segments.includes('..'))throw new SandboxError('PATH_ESCAPE','Paths cannot contain "..". Stay inside the project root.');
    if(segments.some(segment=>segment.toLowerCase()==='.git'||(process.platform==='win32'&&(/[<>:"|?*]/.test(segment)||/[. ]$/.test(segment)))))throw new SandboxError('INVALID_PATH','Git internals and special filesystem paths are not accessible.');
    const rel=segments.join('/');const abs=join(this.root,...segments);
    if(!within(this.root,abs))throw new SandboxError('PATH_ESCAPE','The path leaves the project root.');
    if(await realpath(this.root).catch(()=>null)!==this.root)throw new SandboxError('ROOT_CHANGED','The project folder moved or was replaced. Bind it again.');
    // Follow every existing link in the chain: the real location must stay in the root.
    let probe=abs;
    while(true) {
      try {
        const real=await realpath(probe);
        if(!within(this.root,real))throw new SandboxError('PATH_ESCAPE','The path follows a link that leaves the project root.');
        break;
      } catch(error) {
        if(error instanceof SandboxError)throw error;
        if(!missing(error))throw error;
        if(probe===abs&&!options.allowMissing)throw new SandboxError('NOT_FOUND',`${rel||'.'} does not exist.`);
        const parent=dirname(probe);if(parent===probe||!within(this.root,parent))throw new SandboxError('PATH_ESCAPE','The path leaves the project root.');
        probe=parent;
      }
    }
    return {rel,abs};
  }

  async listDir(path='',depth=1,options:{includeSecrets?:boolean}={}):Promise<{entries:WorkspaceTreeEntry[];limited:boolean}> {
    const {rel,abs}=await this.resolve(path);
    if(!(await stat(abs)).isDirectory())throw new SandboxError('NOT_DIRECTORY',`${rel||'.'} is not a directory.`);
    const entries:WorkspaceTreeEntry[]=[];let limited=false;
    const visit=async(directory:string,prefix:string,level:number)=>{
      const items=(await readdir(directory,{withFileTypes:true})).sort((a,b)=>Number(b.isDirectory())-Number(a.isDirectory())||a.name.localeCompare(b.name));
      for(const item of items) {
        if(entries.length>=LIST_MAX_ENTRIES){limited=true;return;}
        const child=prefix?prefix+'/'+item.name:item.name;
        if(IGNORED_DIRECTORIES.has(item.name.toLowerCase()))continue;
        const secret=isSecretPath(child);if(secret&&!options.includeSecrets)continue;
        if(item.isSymbolicLink()){try {await this.resolve(child);}catch {continue;}}
        const info=await stat(join(directory,item.name)).catch(()=>null);if(!info)continue;
        if(info.isDirectory()){entries.push({path:child,name:item.name,type:'dir'});if(level<depth)await visit(join(directory,item.name),child,level+1);}
        else if(info.isFile())entries.push({path:child,name:item.name,type:'file',size:info.size,...(secret?{secret:true}:{})});
      }
    };
    await visit(abs,rel,1);
    return {entries,limited};
  }

  private async readText(abs:string,rel:string,max=READ_MAX_BYTES) {
    const info=await stat(abs).catch(error=>{if(missing(error))throw new SandboxError('NOT_FOUND',`${rel} does not exist.`);throw error;});
    if(!info.isFile())throw new SandboxError('NOT_FILE',`${rel} is not a file.`);
    if(info.nlink>1)throw new SandboxError('UNSAFE_PATH',`${rel} has hard links and cannot be accessed through workspace tools.`);
    if(info.size>max)throw new SandboxError('FILE_TOO_LARGE',`${rel} is ${Math.round(info.size/1024)} KB; the limit is ${Math.round(max/1024)} KB.`);
    return decode(await readFile(abs),rel);
  }

  async readFile(path:string,range:{startLine?:number;endLine?:number}={}) {
    const {rel,abs}=await this.resolve(path);const content=await this.readText(abs,rel);
    const all=content.split('\n');const totalLines=all.length;
    const startLine=Math.max(1,Math.floor(range.startLine??1));
    let endLine=Math.min(totalLines,Math.floor(range.endLine??totalLines),startLine+READ_MAX_LINES-1);
    let text=all.slice(startLine-1,endLine).join('\n');let truncated=endLine<(range.endLine??totalLines)&&endLine<totalLines;
    if(text.length>READ_MAX_CHARS){text=text.slice(0,READ_MAX_CHARS);endLine=startLine+text.split('\n').length-1;truncated=true;}
    return {path:rel,content:text,startLine,endLine,totalLines,truncated};
  }

  async searchText(query:string,glob?:string) {
    await this.resolve('');
    if(!query.trim())throw new SandboxError('INVALID_QUERY','Search text cannot be empty.');
    const needle=query.toLowerCase();const filter=glob?globToRegExp(glob):null;
    const matches:{path:string;line:number;text:string}[]=[];let scanned=0;let limited=false;
    const visit=async(directory:string,prefix:string):Promise<void>=>{
      for(const item of await readdir(directory,{withFileTypes:true})) {
        if(matches.length>=SEARCH_MAX_HITS||scanned>=SEARCH_MAX_FILES){limited=true;return;}
        const child=prefix?prefix+'/'+item.name:item.name;
        if(item.isSymbolicLink()||isIgnoredPath(child)||isSecretPath(child))continue;
        if(item.isDirectory()){await visit(join(directory,item.name),child);continue;}
        if(!item.isFile()||(filter&&!filter.test(child)))continue;
        scanned++;
        let content:string;try {content=await this.readText(join(directory,item.name),child);}catch {continue;}
        const rows=content.split('\n');
        for(let i=0;i<rows.length&&matches.length<SEARCH_MAX_HITS;i++)if(rows[i]!.toLowerCase().includes(needle))matches.push({path:child,line:i+1,text:rows[i]!.trim().slice(0,240)});
      }
    };
    await visit(this.root,'');
    return {matches,limited:limited||matches.length>=SEARCH_MAX_HITS};
  }

  /** Read-only git. Repository config cannot start fsmonitor helpers or external diff drivers. */
  async git(kind:'status'|'diff'|'log'|'branches'|'compare',path?:string,allowed:(path:string)=>boolean=()=>true,revision?:string):Promise<string> {
    await this.resolve('');
    const run=(args:string[])=>new Promise<string>((resolve,reject)=>execFile('git',['-c','core.fsmonitor=false','-c','core.quotepath=false','-C',this.root,...args],{timeout:10_000,maxBuffer:4*1024*1024,windowsHide:true,env:{...workspaceProcessEnv(),GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0',GIT_LITERAL_PATHSPECS:'1'}},(error,stdout,stderr)=>{
      if(error){const message=(error as NodeJS.ErrnoException).code==='ENOENT'?'git is not installed or not on PATH.':/not a git repository/i.test(String(stderr))?'This folder is not a git repository.':'git failed: '+String(stderr||error.message).slice(0,300);reject(new SandboxError('GIT_UNAVAILABLE',message));}
      else resolve(stdout);
    }));
    let output:string;
    if(kind==='status')output=await run(['status','--porcelain=v1','--branch','--untracked-files=all']);
    else if(kind==='log')output=await run(['log','-30','--format=%h %s','--no-show-signature']);
    else if(kind==='branches')output=await run(['branch','--no-color']);
    else {
      const target=path?(await this.resolve(path,{allowMissing:true})).rel:'.';
      if(path&&(isSecretPath(target)||!allowed(target)))throw new SandboxError('PERMISSION_DENIED','This file is excluded from diffs.');
      if(kind==='compare'&&(!revision||!(/^[a-f0-9]{7,40}$/i.test(revision))))throw new SandboxError('INVALID_REVISION','Enter a commit hash from the history.');
      if(kind==='compare')await run(['rev-parse','--verify',`${revision}^{commit}`]);
      const base=kind==='compare'?[revision!,'HEAD']:await run(['rev-parse','--verify','HEAD']).then(()=>['HEAD']).catch(()=>[]);
      const names=(await run(['diff',...base,'--name-only','-z','--no-renames','--',target||'.'])).split('\0').filter(name=>name&&!isSecretPath(name)&&!isIgnoredPath(name)&&allowed(name));
      // Bound command-line length and diff output for large repositories.
      const parts:string[]=[];let size=0;
      for(const name of names.slice(0,50)){const diff=await run(['diff',...base,'--no-renames','--no-color','--no-ext-diff','--no-textconv','--',name]);parts.push(diff);size+=diff.length;if(size>=READ_MAX_CHARS)break;}
      output=parts.join('');if(names.length>50)output+='\n[More than 50 changed files; select a file to inspect its diff.]';
    }
    const text=redactWorkspaceText(kind==='status'?output.split('\n').filter(line=>{if(line.startsWith('##'))return true;const name=line.slice(3).replace(/^"|"$/g,'').split(' -> ').at(-1)??'';return !isSecretPath(name)&&allowed(name);}).join('\n'):output);
    return text.length>READ_MAX_CHARS?text.slice(0,READ_MAX_CHARS)+'\n[output truncated]':text;
  }

  /** Read once at bind time. Size-capped; never reads anything else. */
  async loadInstructions():Promise<WorkspaceInstructions|null> {
    for(const name of INSTRUCTION_FILES) {
      let resolved;try {resolved=await this.resolve(name);}catch {continue;}
      let content:string;try {content=await this.readText(resolved.abs,name);}catch {continue;}
      const truncated=content.length>INSTRUCTIONS_MAX_CHARS;
      return {path:name,content:content.slice(0,INSTRUCTIONS_MAX_CHARS),characters:Math.min(content.length,INSTRUCTIONS_MAX_CHARS),truncated};
    }
    return null;
  }

  /** Top-level names only, so the model knows where to look. */
  async index():Promise<string[]> {
    const {entries}=await this.listDir('',1);
    return entries.slice(0,120).map(entry=>entry.type==='dir'?entry.path+'/':entry.path);
  }

  async planEdit(path:string,oldText:string,newText:string):Promise<PlannedChange> {
    if(!oldText)throw new SandboxError('INVALID_EDIT','oldText must be a non-empty snippet copied from the file.');
    if(oldText===newText)throw new SandboxError('INVALID_EDIT','oldText and newText are identical.');
    const {rel,abs}=await this.resolve(path);const before=await this.readText(abs,rel);
    const matches=count(before,oldText);
    if(!matches)throw new SandboxError('EDIT_NOT_FOUND',`oldText was not found in ${rel}. Re-read the file and copy the exact text.`);
    if(matches>1)throw new SandboxError('EDIT_NOT_UNIQUE',`oldText matches ${matches} places in ${rel}. Include more surrounding lines so it is unique.`);
    const index=before.indexOf(oldText);const after=before.slice(0,index)+newText+before.slice(index+oldText.length);
    if(Buffer.byteLength(after)>WRITE_MAX_BYTES)throw new SandboxError('FILE_TOO_LARGE','The edited file would exceed 512 KB.');
    return {path:rel,before,after,diff:unifiedDiff(rel,before,after)};
  }

  async planWrite(path:string,content:string):Promise<PlannedChange> {
    if(Buffer.byteLength(content)>WRITE_MAX_BYTES)throw new SandboxError('FILE_TOO_LARGE','Files written by the agent must be 512 KB or smaller.');
    const {rel,abs}=await this.resolve(path,{allowMissing:true});
    if(!rel)throw new SandboxError('INVALID_PATH','Choose a file path, not the project root.');
    const existing=await stat(abs).catch(error=>{if(missing(error))return null;throw error;});
    if(existing&&!existing.isFile())throw new SandboxError('NOT_FILE',`${rel} is not a file.`);
    const before=existing?await this.readText(abs,rel):null;
    return {path:rel,before,after:content,diff:unifiedDiff(rel,before,content)};
  }

  async planDelete(path:string):Promise<PlannedChange> {
    const {rel,abs}=await this.resolve(path);const before=await this.readText(abs,rel);
    return {path:rel,before,after:null,diff:unifiedDiff(rel,before,null)};
  }

  /** Writes only if the file still has the content the diff was computed from. */
  async apply(change:{path:string;before:string|null;after:string|null}) {
    const {abs}=await this.resolve(change.path,{allowMissing:true});
    const key=process.platform==='win32'?abs.toLowerCase():abs;
    const previous=writes.get(key)??Promise.resolve();
    const next=previous.catch(()=>{}).then(()=>this.applyLocked(change));writes.set(key,next);
    try{await next;}finally{if(writes.get(key)===next)writes.delete(key);}
  }

  private async applyLocked(change:{path:string;before:string|null;after:string|null}) {
    if(change.after!==null&&Buffer.byteLength(change.after)>WRITE_MAX_BYTES)throw new SandboxError('FILE_TOO_LARGE','Files must be 512 KB or smaller.');
    const {rel,abs}=await this.resolve(change.path,{allowMissing:true});
    const current=await this.readText(abs,rel).catch(error=>{if(error instanceof SandboxError&&error.code==='NOT_FOUND')return null;throw error;});
    if((current===null?null:sha(current))!==(change.before===null?null:sha(change.before)))throw new SandboxError('CONFLICT',`${rel} changed on disk after this change was proposed. Reject it and ask for a fresh edit.`);
    if(change.after===null){await unlink(abs);return;}
    if(current===null) {
      await mkdir(dirname(abs),{recursive:true});
      await this.resolve(change.path,{allowMissing:true});
    } else if((await lstat(abs)).isSymbolicLink())throw new SandboxError('UNSAFE_PATH',`${rel} is a link; edit its target directly.`);
    const temp=join(dirname(abs),'.omnichat-'+randomUUID()+'.tmp');
    const mode=current===null?0o644:(await stat(abs)).mode;
    try {
      await writeFile(temp,change.after,{encoding:'utf8',flag:'wx',mode});
      if(current===null)await link(temp,abs).catch(error=>{if(error.code==='EEXIST')throw new SandboxError('CONFLICT',`${rel} was created by another process.`);throw error;});
      else {
        if(await this.readText(abs,rel)!==current)throw new SandboxError('CONFLICT',`${rel} changed while preparing the write.`);
        await rename(temp,abs);
      }
    }
    finally {await unlink(temp).catch(()=>{});}
  }
}
