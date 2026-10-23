'use client';
import {useEffect,useRef,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import type {WorkspaceSessionView} from '@omnichat/types';
import {api,errorMessage} from '@/lib/api';
import {ErrorNotice,Modal,Select} from './ui';
import '@xterm/xterm/css/xterm.css';

export function LocalTerminal({session}:{session:WorkspaceSessionView}){
  const client=useQueryClient();const [active,setActive]=useState<string|null>(null);const [shell,setShell]=useState('');const [command,setCommand]=useState('');const [approval,setApproval]=useState<'open'|'command'|null>(null);const [error,setError]=useState<string|null>(null);
  const [history,setHistory]=useState<string[]>([]);const host=useRef<HTMLDivElement>(null);
  const base=`/workspace/sessions/${session.id}/terminals`;
  const terminals=useQuery({queryKey:['workspace-terminals',session.id],queryFn:()=>api.request<{shells:string[];items:{id:string;shell:string;closed:boolean}[]}>(base)});
  const action=useMutation({mutationFn:async()=>{
    if(approval==='open'){const result=await api.request<{id:string}>(base,{method:'POST',body:{shell:shell||terminals.data?.shells[0],approved:true}});setActive(result.id);}
    else if(active){await api.request(`${base}/${active}`,{method:'POST',body:{action:'command',command,approved:true}});setHistory(items=>[command,...items.filter(item=>item!==command)].slice(0,50));setCommand('');}
  },onSuccess:()=>{setApproval(null);void client.invalidateQueries({queryKey:['workspace-terminals',session.id]});}});
  useEffect(()=>{
    if(!active||!host.current)return;
    let disposed=false;let cursor=0;let timer:ReturnType<typeof setTimeout>|undefined;let terminal:import('@xterm/xterm').Terminal|undefined;let observer:ResizeObserver|undefined;
    void (async()=>{
      const [{Terminal},{FitAddon}]=await Promise.all([import('@xterm/xterm'),import('@xterm/addon-fit')]);if(disposed||!host.current)return;
      terminal=new Terminal({disableStdin:true,convertEol:false,fontSize:12,scrollback:3000,theme:{background:'#101214',foreground:'#ddd'}});const fit=new FitAddon();terminal.loadAddon(fit);terminal.open(host.current);
      const resize=()=>{if(!host.current?.clientWidth)return;fit.fit();void api.request(`${base}/${active}`,{method:'POST',body:{action:'resize',cols:Math.max(10,Math.min(300,terminal!.cols)),rows:Math.max(5,Math.min(150,terminal!.rows))}}).catch(()=>{});};
      observer=new ResizeObserver(resize);observer.observe(host.current);resize();
      const poll=async()=>{try{const result=await api.request<{output:string;cursor:number;reset:boolean;closed:boolean;exitCode:number|null}>(`${base}/${active}?cursor=${cursor}`);if(disposed)return;if(result.reset)terminal!.reset();terminal!.write(result.output);cursor=result.cursor;if(result.closed){terminal!.writeln(`\r\n[Terminal exited: ${result.exitCode??'closed'}]`);return;}}catch(value){if(!disposed)setError(errorMessage(value));return;}if(!disposed)timer=setTimeout(()=>void poll(),1000);};
      await poll();
    })().catch(value=>setError(errorMessage(value)));
    return()=>{disposed=true;clearTimeout(timer);observer?.disconnect();terminal?.dispose();};
  },[active,base]);
  const control=async(kind:'interrupt'|'close')=>{if(!active)return;try{await api.request(`${base}/${active}`,kind==='close'?{method:'DELETE'}:{method:'POST',body:{action:'interrupt'}});if(kind==='close'){setActive(null);void client.invalidateQueries({queryKey:['workspace-terminals',session.id]});}}catch(value){setError(errorMessage(value));}};
  const enabled=session.commandsEnabled&&session.mode==='agent';
  return <div className="lw-terminal">
    <div className="lw-panel-toolbar"><Select label="Shell" value={shell||terminals.data?.shells[0]||''} onChange={setShell}>{terminals.data?.shells.map(value=><option key={value}>{value}</option>)}</Select><button className="button secondary" disabled={!enabled} onClick={()=>setApproval('open')}>New terminal</button>{active&&<><button className="button secondary" onClick={()=>void control('interrupt')}>Interrupt</button><button className="button secondary" onClick={()=>void control('close')}>Close</button></>}</div>
    <div className="lw-panel-toolbar" role="tablist" aria-label="Terminals">{terminals.data?.items.map((item,index)=><button role="tab" aria-selected={active===item.id} key={item.id} className="button secondary" onClick={()=>{setError(null);setActive(item.id);}}>{item.shell} {index+1}</button>)}</div>
    <div className="lw-terminal-screen" ref={host}/>
    {!enabled&&<p className="muted">Enable local commands on the companion and select Agent mode to use terminals.</p>}
    <form className="lw-panel-toolbar" onSubmit={event=>{event.preventDefault();setApproval('command');}}><input aria-label="Terminal command" list={`commands-${session.id}`} value={command} onChange={event=>setCommand(event.target.value)} placeholder="Enter command"/><datalist id={`commands-${session.id}`}>{history.map(item=><option key={item} value={item}/>)}</datalist><button className="button primary" disabled={!active||!enabled||!command.trim()}>Review command</button></form>
    <ErrorNotice message={error||terminals.error&&errorMessage(terminals.error)}/>
    <Modal open={!!approval} onOpenChange={open=>!open&&setApproval(null)} title={approval==='open'?'Open local terminal?':'Run this command?'} description="Runs as your local account. Commands can modify files, access the network, and leave the project directory. Approve only commands you trust.">
      <code>{approval==='open'?`${shell||terminals.data?.shells[0]} in ${session.root}`:command}</code><ErrorNotice message={action.error&&errorMessage(action.error)}/><button className="button primary" disabled={action.isPending} onClick={()=>action.mutate()}>Approve and {approval==='open'?'open':'run'}</button>
    </Modal>
  </div>;
}
