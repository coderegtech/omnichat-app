import {randomUUID} from 'node:crypto';
import type {IPty} from 'node-pty';
import {SandboxError,workspaceProcessEnv} from './workspace-sandbox.js';

export const terminalShells=process.platform==='win32'?['powershell','cmd']:['bash','sh','zsh'];
export class WorkspaceTerminal {
  readonly id=randomUUID();output='';offset=0;exitCode:number|null=null;touchedAt=Date.now();closed=false;
  private finish!:()=>void;
  private exited=new Promise<void>(resolve=>{this.finish=resolve;});
  private closing:Promise<void>|null=null;
  private constructor(readonly sessionId:string,readonly shell:string,private pty:IPty){
    pty.onData(data=>{this.output+=data;if(this.output.length>256_000){const removed=this.output.length-256_000;this.output=this.output.slice(removed);this.offset+=removed;}});
    pty.onExit(({exitCode})=>{this.exitCode=exitCode;this.closed=true;this.finish();});
  }
  static async open(sessionId:string,root:string,shell:string){
    if(!terminalShells.includes(shell))throw new SandboxError('INVALID_SHELL','Choose an available shell.');
    const {spawn}=await import('node-pty');
    // An allowlist avoids passing API/database credentials through the terminal.
    const env={...workspaceProcessEnv(),TERM:'xterm-256color'};
    const file=process.platform==='win32'?shell+'.exe':shell;
    const args=shell==='powershell'?['-NoLogo','-NoProfile']:shell==='cmd'?['/d']:shell==='bash'?['--noprofile','--norc']:shell==='zsh'?['-f']:[];
    return new WorkspaceTerminal(sessionId,shell,spawn(file,args,{cwd:root,env,name:'xterm-256color',cols:100,rows:28,...(process.platform==='win32'?{useConptyDll:true}:{})}));
  }
  view(cursor=0){this.touchedAt=Date.now();return {id:this.id,shell:this.shell,output:this.output.slice(Math.max(0,cursor-this.offset)),cursor:this.offset+this.output.length,reset:cursor<this.offset,closed:this.closed,exitCode:this.exitCode};}
  write(command:string){if(this.closed)throw new SandboxError('TERMINAL_CLOSED','This terminal has exited.');this.touchedAt=Date.now();this.pty.write(command+'\r');}
  resize(cols:number,rows:number){if(!this.closed)this.pty.resize(cols,rows);}
  interrupt(){if(!this.closed)this.pty.write('\x03');}
  close():Promise<void>{
    if(this.closing)return this.closing;
    if(this.closed)return Promise.resolve();
    // node-pty owns ConPTY process-tree cleanup on Windows.
    if(process.platform!=='win32'){try{process.kill(-this.pty.pid,'SIGKILL');}catch{/* Already exited. */}}
    try{this.pty.kill();}catch{/* Exit notification may already be queued. */}
    this.closing=new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new SandboxError('TERMINAL_CLEANUP','Terminal exit could not be confirmed.')),7000);
      void this.exited.then(()=>{clearTimeout(timer);resolve();});
    });
    return this.closing;
  }
}
