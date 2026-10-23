import {execFile} from 'node:child_process';
import {z} from 'zod';
import {isSecretPath} from './workspace-permissions.js';
import {SandboxError,WorkspaceSandbox,workspaceProcessEnv} from './workspace-sandbox.js';

export const gitAction=z.object({
  action:z.enum(['stage','unstage','commit','create-branch','switch-branch','push','pull']),
  value:z.string().min(1).max(1000).optional(),approved:z.literal(true),
}).strict();
export function gitCommand(root:string,args:string[],signal?:AbortSignal):Promise<string> {
  return new Promise((resolve,reject)=>execFile('git',['-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null','-c','commit.gpgSign=false','-c','core.pager=cat','-C',root,...args],{
    timeout:60_000,maxBuffer:4*1024*1024,windowsHide:true,signal,
    env:{...workspaceProcessEnv(),...(process.env.SSH_AUTH_SOCK?{SSH_AUTH_SOCK:process.env.SSH_AUTH_SOCK}:{}),GIT_TERMINAL_PROMPT:'0',GIT_LITERAL_PATHSPECS:'1'},
  },(error,stdout,stderr)=>error?reject(new SandboxError('GIT_FAILED',String(stderr||error.message).slice(0,1000))):resolve(stdout)));
}
export async function mutateGit(sandbox:WorkspaceSandbox,input:z.infer<typeof gitAction>,signal?:AbortSignal) {
  await sandbox.resolve('');
  const run=(args:string[])=>gitCommand(sandbox.root,args,signal);
  const top=(await run(['rev-parse','--show-toplevel'])).trim();
  const actual=await WorkspaceSandbox.open(top);
  if(actual.root!==sandbox.root)throw new SandboxError('PERMISSION_DENIED','Link the repository root before changing Git state.');
  const value=input.value??'';
  switch(input.action){
    case 'stage':case 'unstage': {
      const {rel}=await sandbox.resolve(value,{allowMissing:true});
      if(!rel||isSecretPath(rel))throw new SandboxError('PERMISSION_DENIED','Choose a non-secret file.');
      // A literal path prevents wildcard and pathspec expansion.
      if(input.action==='stage'){
        const {stat}=await import('node:fs/promises');
        const info=await stat((await sandbox.resolve(value,{allowMissing:true})).abs).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
        if(info&&!info.isFile())throw new SandboxError('INVALID_PATH','Stage individual files.');
        return run(['add','--',rel]);
      }
      return run(['restore','--staged','--',rel]);
    }
    case 'commit': {
      if(!value.trim())throw new SandboxError('INVALID_MESSAGE','Enter a commit message.');
      const names=(await run(['diff','--cached','--name-only','-z'])).split('\0').filter(Boolean);
      if(names.some(isSecretPath))throw new SandboxError('SECRET_FILE','Unstage credential files before committing.');
      return run(['commit','-m',value]);
    }
    case 'create-branch':case 'switch-branch':
      if(!value||value.startsWith('-'))throw new SandboxError('INVALID_BRANCH','Enter a branch name.');
      await run(['check-ref-format','--branch',value]);
      if((await run(['status','--porcelain'])).trim())throw new SandboxError('CONFLICT','Commit or stash working changes before switching branches.');
      return run(input.action==='create-branch'?['switch','-c',value]:['switch',value]);
    case 'push':return run(['push']);
    case 'pull':
      if((await run(['status','--porcelain'])).trim())throw new SandboxError('CONFLICT','Commit or stash working changes before pulling.');
      return run(['pull','--ff-only']);
  }
}
