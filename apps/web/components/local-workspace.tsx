'use client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {AlertTriangle,Bot,Check,ChevronDown,ChevronRight,CornerLeftUp,ExternalLink,File,Folder,FolderOpen,Lock,Play,Plus,ShieldCheck,Square,Trash2,Unlink,Wrench,X} from 'lucide-react';
import type {ModelRegistry,WorkspaceEvent,WorkspacePendingChange,WorkspacePermissionRule,WorkspaceSessionView,WorkspaceToolCall,WorkspaceTreeEntry} from '@omnichat/types';
import {api,errorMessage} from '@/lib/api';
import {useUi} from '@/lib/store';
import {Markdown} from './chat';
import {Busy,ErrorNotice,Field,Modal,Select} from './ui';
import './local-workspace.css';

const STORAGE_KEY='omnichat.workspace-session';
type Done=Extract<WorkspaceEvent,{type:'done'}>['reason'];
const doneLabels:Record<Done,string>={complete:'Turn complete',awaiting_approval:'Waiting for your decision',tool_error:'Stopped after a tool error',stopped:'Stopped',limit:'Step limit reached — continue to keep going'};
const remember=(id:string|null)=>{try{if(id)sessionStorage.setItem(STORAGE_KEY,id);else sessionStorage.removeItem(STORAGE_KEY);}catch{/* storage may be unavailable */}};
const recalled=()=>{try{return sessionStorage.getItem(STORAGE_KEY);}catch{return null;}};

export function DiffView({diff}:{diff:string}) {
  return <pre className="lw-diff" aria-label="Unified diff">{diff.split('\n').filter((line,index,all)=>line||index<all.length-1).map((line,index)=><span key={index} className={line.startsWith('@@')?'hunk':line.startsWith('+++')||line.startsWith('---')?'meta':line.startsWith('+')?'add':line.startsWith('-')?'del':''}>{line||' '}{'\n'}</span>)}</pre>;
}

function describeCall(call:WorkspaceToolCall) {
  switch(call.tool) {
    case 'list_dir': return `list_dir ${call.path||'.'}${call.depth?` · depth ${call.depth}`:''}`;
    case 'read_file': return `read_file ${call.path}${call.startLine||call.endLine?` · ${call.startLine??1}–${call.endLine??'end'}`:''}`;
    case 'search_text': return `search_text "${call.query}"${call.glob?` in ${call.glob}`:''}`;
    case 'git_status': return 'git_status';
    case 'git_diff': return `git_diff ${call.path??''}`.trim();
    case 'edit_file': case 'write_file': case 'delete_file': return `${call.tool} ${call.path}`;
    case 'run_command': return `run_command ${call.program} ${call.args.join(' ')}`;
  }
}

function FolderPicker({onBind,binding,error}:{onBind:(path:string)=>void;binding:boolean;error?:string|null}) {
  const [path,setPath]=useState<string|null>(null);const [manual,setManual]=useState('');
  const roots=useQuery({queryKey:['workspace-roots'],queryFn:()=>api.request<{items:{path:string;label:string}[];reason?:string}>('/workspace/roots')});
  const browse=useQuery({queryKey:['workspace-browse',path],enabled:!!path,queryFn:()=>api.request<{path:string;parent:string|null;directories:{name:string;path:string}[];hasInstructions:boolean}>(`/workspace/browse?path=${encodeURIComponent(path!)}`)});
  return <div className="lw-picker">
    <div className="lw-picker-heading"><span className="eyebrow">LOCAL PROJECT</span><h1>Work on a folder <em>on this machine.</em></h1><p>The agent reads files on demand, pins <code>CLAUDE.md</code> or <code>AGENTS.md</code> as standing instructions, and changes files only after you approve. Nothing is uploaded to a file store.</p></div>
    <div className="lw-picker-panel">
      {roots.isLoading&&<Busy label="Loading allowed folders"/>}
      <ErrorNotice message={roots.error?errorMessage(roots.error):roots.data?.reason}/>
      {!path&&roots.data?.items.map(root=><button key={root.path} className="lw-dir" onClick={()=>setPath(root.path)}><FolderOpen size={16}/><span><strong>{root.label}</strong><small>{root.path}</small></span><ChevronRight size={15}/></button>)}
      {path&&<>
        <div className="lw-browse-bar"><button className="icon-button" aria-label="Up one folder" title="Up one folder" onClick={()=>setPath(browse.data?.parent??null)}><CornerLeftUp size={16}/></button><code title={browse.data?.path??path}>{browse.data?.path??path}</code></div>
        {browse.isLoading&&<Busy/>}<ErrorNotice message={browse.error&&errorMessage(browse.error)}/>
        <div className="lw-dir-list">{browse.data?.directories.map(dir=><button key={dir.path} className="lw-dir" onClick={()=>setPath(dir.path)}><Folder size={15}/><span>{dir.name}</span><ChevronRight size={14}/></button>)}{browse.data&&!browse.data.directories.length&&<p className="muted">No subfolders.</p>}</div>
        <div className="lw-bind-row">{browse.data?.hasInstructions&&<span className="lw-badge"><ShieldCheck size={13}/>Has project instructions</span>}<button className="button primary" disabled={binding||!browse.data} onClick={()=>browse.data&&onBind(browse.data.path)}>{binding?'Binding…':'Bind this folder'}</button></div>
      </>}
      {!!roots.data?.items.length&&<form className="lw-manual" onSubmit={event=>{event.preventDefault();if(manual.trim())onBind(manual.trim());}}><Field label="Or enter a folder path on the API computer"><input value={manual} onChange={event=>setManual(event.target.value)} placeholder="C:/Projects/my-app" aria-label="Folder path"/></Field><button className="button secondary" disabled={binding||!manual.trim()}>Bind</button></form>}
      <ErrorNotice message={error}/>
    </div>
  </div>;
}

type TreeProps={sessionId:string;path:string;depth:number;open:Record<string,boolean>;toggle:(path:string)=>void;onAdd:(entry:WorkspaceTreeEntry)=>void;disabled:boolean};
function TreeLevel(props:TreeProps) {
  const {sessionId,path,depth,open,toggle,onAdd,disabled}=props;
  const tree=useQuery({queryKey:['workspace-tree',sessionId,path],queryFn:()=>api.request<{entries:WorkspaceTreeEntry[];limited:boolean}>(`/workspace/sessions/${sessionId}/tree?path=${encodeURIComponent(path)}`)});
  if(tree.isLoading)return <div className="lw-tree-note" style={{paddingLeft:12+depth*12}}><Busy/></div>;
  if(tree.error)return <div className="lw-tree-note" style={{paddingLeft:12+depth*12}}>{errorMessage(tree.error)}</div>;
  return <>{tree.data?.entries.map(entry=>entry.type==='dir'?<div key={entry.path}>
    <button className="lw-tree-row" style={{paddingLeft:8+depth*12}} onClick={()=>toggle(entry.path)} aria-expanded={!!open[entry.path]}>{open[entry.path]?<ChevronDown size={13}/>:<ChevronRight size={13}/>}<Folder size={14}/><span>{entry.name}</span></button>
    {open[entry.path]&&<TreeLevel {...props} path={entry.path} depth={depth+1}/>}
  </div>:<div key={entry.path} className="lw-tree-row file" style={{paddingLeft:22+depth*12}}>{entry.secret?<Lock size={13}/>:<File size={13}/>}<span title={entry.path}>{entry.name}</span><button className="icon-button" disabled={disabled} aria-label={`Add ${entry.path} to context`} title={entry.secret?'Secret file: asks before sending':'Add to context'} onClick={()=>onAdd(entry)}><Plus size={13}/></button></div>)}
  {tree.data?.limited&&<div className="lw-tree-note" style={{paddingLeft:12+depth*12}}>Listing limited.</div>}</>;
}
function FileTree({sessionId,onAdd,disabled}:{sessionId:string;onAdd:(entry:WorkspaceTreeEntry)=>void;disabled:boolean}) {
  const [open,setOpen]=useState<Record<string,boolean>>({});
  const toggle=useCallback((path:string)=>setOpen(state=>({...state,[path]:!state[path]})),[]);
  return <div className="lw-tree" aria-label="Project files"><TreeLevel sessionId={sessionId} path="" depth={0} open={open} toggle={toggle} onAdd={onAdd} disabled={disabled}/></div>;
}

const presets:{label:string;rule:Omit<WorkspacePermissionRule,'id'>}[]=[
  {label:'Allow edits in src/',rule:{effect:'allow',action:'edit',pattern:'src/'}},
  {label:'Deny .env',rule:{effect:'deny',action:'read',pattern:'.env*'}},
  {label:'Deny reads in secrets/',rule:{effect:'deny',action:'read',pattern:'secrets/'}},
];
function Permissions({open,onOpenChange,session,onSaved}:{open:boolean;onOpenChange:(open:boolean)=>void;session:WorkspaceSessionView;onSaved:()=>void}) {
  const [rules,setRules]=useState(session.rules);const [effect,setEffect]=useState<'allow'|'deny'>('allow');const [action,setAction]=useState<WorkspacePermissionRule['action']>('edit');const [pattern,setPattern]=useState('');
  useEffect(()=>{if(open)setRules(session.rules);},[open,session.rules]);
  const save=useMutation({mutationFn:()=>api.request(`/workspace/sessions/${session.id}/rules`,{method:'PUT',body:{rules}}),onSuccess:()=>{onSaved();onOpenChange(false);}});
  const add=(rule:Omit<WorkspacePermissionRule,'id'>)=>setRules(items=>[...items,{...rule,id:crypto.randomUUID()}]);
  return <Modal open={open} onOpenChange={onOpenChange} title="Session permissions" description="Reads inside the folder are allowed and edits ask by default. Deletes and commands always ask. Deny rules win. These rules last for this session.">
    <div className="lw-rules">
      {rules.length?rules.map(rule=><div className="lw-rule" key={rule.id}><span className={`lw-effect ${rule.effect}`}>{rule.effect}</span><span>{rule.action}</span><code>{rule.pattern}</code><button className="icon-button" aria-label="Remove rule" onClick={()=>setRules(items=>items.filter(item=>item.id!==rule.id))}><Trash2 size={14}/></button></div>):<p className="muted">No custom rules. Defaults apply.</p>}
      <div className="lw-presets">{presets.map(preset=><button key={preset.label} className="button secondary" onClick={()=>add(preset.rule)}>{preset.label}</button>)}</div>
      <form className="lw-rule-form" onSubmit={event=>{event.preventDefault();if(pattern.trim()){add({effect,action,pattern:pattern.trim()});setPattern('');}}}>
        <Select label="Effect" value={effect} onChange={value=>setEffect(value as 'allow'|'deny')}><option value="allow">Allow</option><option value="deny">Deny</option></Select>
        <Select label="Action" value={action} onChange={value=>setAction(value as WorkspacePermissionRule['action'])}><option value="read">Read</option><option value="edit">Edit</option><option value="delete">Delete</option><option value="command">Command</option></Select>
        <input aria-label="Path pattern" value={pattern} onChange={event=>setPattern(event.target.value)} placeholder="src/**/*.ts"/>
        <button className="button secondary" disabled={!pattern.trim()}>Add</button>
      </form>
      <ErrorNotice message={save.error&&errorMessage(save.error)}/>
      <div className="lw-modal-actions"><button className="button secondary" onClick={()=>onOpenChange(false)}>Cancel</button><button className="button primary" disabled={save.isPending} onClick={()=>save.mutate()}>Save rules</button></div>
    </div>
  </Modal>;
}

function PendingCard({change,live,decide,busy}:{change:WorkspacePendingChange;live:WorkspacePendingChange|undefined;decide:(id:string,approve:boolean)=>void;busy:boolean}) {
  const current=live??change;const isPending=current.status==='pending';
  return <div className={`lw-card lw-pending ${current.status}`}>
    <div className="lw-card-heading">{current.kind==='command'?<Wrench size={15}/>:<File size={15}/>}<strong>{current.kind==='command'?`Run ${current.program} ${current.args?.join(' ')}`:`${current.kind==='delete'?'Delete':current.kind==='write'?'Write':'Edit'} ${current.path}`}</strong><span className={`lw-status ${current.status}`}>{isPending?'Needs approval':current.status}</span></div>
    {current.diff&&<DiffView diff={current.diff}/>}
    {current.kind==='command'&&<p className="muted">Runs on this computer in the project folder, with sensitive environment variables removed and a two-minute timeout.</p>}
    {isPending&&<div className="lw-card-actions"><button className="button secondary" disabled={busy} onClick={()=>decide(current.id,false)}><X size={14}/>Reject</button><button className="button primary" disabled={busy} onClick={()=>decide(current.id,true)}><Check size={14}/>{current.kind==='command'?'Run':'Accept'}</button></div>}
  </div>;
}

function ToolRow({call,result}:{call:WorkspaceToolCall;result?:Extract<WorkspaceEvent,{type:'tool_result'}>}) {
  const [open,setOpen]=useState(false);const expandable=!!(result?.detail||result?.diff);
  return <div className={`lw-tool ${result?(result.ok?'ok':'failed'):'running'}`}>
    <button className="lw-tool-row" onClick={()=>expandable&&setOpen(value=>!value)} aria-expanded={expandable?open:undefined} disabled={!expandable}>
      {expandable?(open?<ChevronDown size={13}/>:<ChevronRight size={13}/>):<span className="lw-dot"/>}<code>{describeCall(call)}</code>{result?<span className="lw-tool-summary">{result.summary}</span>:<Busy label=""/>}
    </button>
    {open&&result?.diff&&<DiffView diff={result.diff}/>}
    {open&&result?.detail&&!result.diff&&<pre className="lw-output">{result.detail}</pre>}
  </div>;
}

function Transcript({events,pending,decide,busy}:{events:WorkspaceEvent[];pending:WorkspacePendingChange[];decide:(id:string,approve:boolean)=>void;busy:boolean}) {
  const results=new Map<string,Extract<WorkspaceEvent,{type:'tool_result'}>>();const decisions=new Map<string,WorkspacePendingChange>();
  for(const event of events){if(event.type==='tool_result')results.set(event.id,event);if(event.type==='decision')decisions.set(event.change.id,event.change);}
  const live=new Map(pending.map(item=>[item.id,item]));
  return <>{events.map((event,index)=>{
    switch(event.type) {
      case 'user': return <div key={index} className="lw-user">{event.text}</div>;
      case 'assistant': return <div key={index} className="lw-assistant"><Bot size={15}/><Markdown content={event.text}/></div>;
      case 'context': return <div key={index} className="lw-note"><Plus size={13}/>Added <code>{event.path}</code> to context · {event.lines} lines{event.truncated?' (truncated)':''}</div>;
      case 'tool_call': return <ToolRow key={index} call={event.call} result={results.get(event.id)}/>;
      case 'pending': return <PendingCard key={index} change={decisions.get(event.change.id)??event.change} live={live.get(event.change.id)} decide={decide} busy={busy}/>;
      case 'decision': return <div key={index} className={`lw-note ${event.change.status}`}>{event.change.status==='applied'?<Check size={13}/>:event.change.status==='rejected'?<X size={13}/>:<AlertTriangle size={13}/>}{event.change.kind==='command'?`${event.change.program} ${event.change.args?.join(' ')}`:event.change.path} · {event.change.status}{event.change.error?` — ${event.change.error}`:''}{event.change.output!==undefined&&<pre className="lw-output">{event.change.output||'(no output)'}</pre>}</div>;
      case 'error': return <ErrorNotice key={index} message={event.message}/>;
      case 'done': return <div key={index} className="lw-done">{doneLabels[event.reason]}</div>;
      default: return null;
    }
  })}</>;
}

export function LocalWorkspace({registry}:{registry?:ModelRegistry}) {
  const queryClient=useQueryClient();const modelId=useUi(s=>s.modelId);
  const [sessionId,setSessionId]=useState<string|null>(null);const [ready,setReady]=useState(false);
  const [streamEvents,setStreamEvents]=useState<WorkspaceEvent[]>([]);const [running,setRunning]=useState(false);
  const [prompt,setPrompt]=useState('');const [error,setError]=useState<string|null>(null);const [permissionsOpen,setPermissionsOpen]=useState(false);
  const [secretPrompt,setSecretPrompt]=useState<string|null>(null);const abort=useRef<AbortController|null>(null);const bottom=useRef<HTMLDivElement>(null);
  useEffect(()=>{setSessionId(recalled());setReady(true);},[]);
  const session=useQuery({queryKey:['workspace-session',sessionId],enabled:!!sessionId,retry:false,queryFn:()=>api.request<WorkspaceSessionView>(`/workspace/sessions/${sessionId}`)});
  useEffect(()=>{if(session.error){remember(null);setSessionId(null);}},[session.error]);
  const view=session.data;
  const events=useMemo(()=>[...(view?.transcript??[]),...streamEvents],[view?.transcript,streamEvents]);
  useEffect(()=>{bottom.current?.scrollIntoView({block:'end'});},[events.length]);
  const refresh=useCallback(async()=>{await queryClient.invalidateQueries({queryKey:['workspace-session',sessionId]});setStreamEvents([]);},[queryClient,sessionId]);
  const bind=useMutation({mutationFn:(path:string)=>api.request<WorkspaceSessionView>('/workspace/sessions',{method:'POST',body:{path}}),onSuccess:data=>{remember(data.id);queryClient.setQueryData(['workspace-session',data.id],data);setSessionId(data.id);}});
  const unbind=useMutation({mutationFn:()=>api.request(`/workspace/sessions/${sessionId}`,{method:'DELETE'}),onSettled:()=>{remember(null);setSessionId(null);setStreamEvents([]);}});
  const decision=useMutation({mutationFn:({id,approve}:{id:string;approve:boolean})=>api.request(`/workspace/sessions/${sessionId}/changes/${id}`,{method:'POST',body:{decision:approve?'approve':'reject'}}),onSettled:()=>refresh(),onError:value=>setError(errorMessage(value))});
  const addContext=useMutation({mutationFn:({path,allowSecret}:{path:string;allowSecret:boolean})=>api.request(`/workspace/sessions/${sessionId}/context`,{method:'POST',body:{path,allowSecret}}),onSuccess:()=>refresh(),onError:(value,variables)=>{if((value as {code?:string}).code==='SECRET_FILE'&&!variables.allowSecret)setSecretPrompt(variables.path);else setError(errorMessage(value));}});
  const model=registry?.models.find(item=>item.id===modelId);
  const pending=view?.pending.filter(item=>item.status==='pending')??[];
  const lastDone=[...events].reverse().find((event):event is Extract<WorkspaceEvent,{type:'done'}>=>event.type==='done');
  const canContinue=!running&&!pending.length&&!!lastDone&&['awaiting_approval','limit'].includes(lastDone.reason);

  const send=async(text?:string)=>{
    if(!sessionId||!model?.capabilities.chat||running)return;
    setError(null);setRunning(true);const controller=new AbortController();abort.current=controller;
    if(text)setPrompt('');
    try {for await(const event of api.streamEvents<WorkspaceEvent>(`/workspace/sessions/${sessionId}/messages`,{modelId,...(text?{prompt:text}:{})},controller.signal))setStreamEvents(items=>[...items,event]);}
    catch(value){if(!controller.signal.aborted)setError(errorMessage(value));}
    finally {setRunning(false);abort.current=null;await refresh();}
  };
  const stop=async()=>{await api.request(`/workspace/sessions/${sessionId}/stop`,{method:'POST'}).catch(()=>{});};

  if(!ready)return null;
  if(!sessionId||(!view&&!session.isLoading))return <div className="lw-root"><FolderPicker onBind={path=>bind.mutate(path)} binding={bind.isPending} error={bind.error&&errorMessage(bind.error)}/></div>;
  if(!view)return <div className="lw-root"><Busy label="Opening workspace"/></div>;
  return <div className="lw-root bound">
    <header className="lw-header">
      <FolderOpen size={16}/><div className="lw-bound"><strong>{view.name}</strong><code title={view.root}>{view.root}</code></div>
      {view.instructions?<span className="lw-badge" title={`${view.instructions.characters.toLocaleString()} characters pinned as standing instructions`}><ShieldCheck size={13}/>{view.instructions.path} pinned{view.instructions.truncated?' (truncated)':''}</span>:<span className="lw-badge muted">No CLAUDE.md / AGENTS.md</span>}
      <div className="lw-header-actions">
        <button className="button secondary" onClick={()=>setPermissionsOpen(true)}><ShieldCheck size={14}/>Permissions{view.rules.length?` (${view.rules.length})`:''}</button>
        <a className="button secondary" href={`vscode://file/${view.root.replace(/\\/g,'/')}`} title="Open the folder in VS Code if it is installed"><ExternalLink size={14}/>Open in editor</a>
        <button className="button secondary" disabled={running} onClick={()=>unbind.mutate()}><Unlink size={14}/>Unbind</button>
      </div>
    </header>
    <div className="lw-body">
      <aside className="lw-sidebar"><div className="lw-sidebar-heading">FILES <small>add to context</small></div><FileTree sessionId={view.id} disabled={running||addContext.isPending} onAdd={entry=>addContext.mutate({path:entry.path,allowSecret:false})}/></aside>
      <section className="lw-chat">
        <div className="lw-transcript" aria-live="polite">
          {!events.length&&<div className="lw-empty"><Bot size={26}/><h2>What should we change in {view.name}?</h2><p>The agent starts with {view.instructions?`${view.instructions.path} and `:''}the top-level file list, then reads only what it needs. Edits wait for your approval unless a permission rule allows them.</p></div>}
          <Transcript events={events} pending={pending} decide={(id,approve)=>decision.mutate({id,approve})} busy={decision.isPending||running}/>
          <div ref={bottom}/>
        </div>
        <ErrorNotice message={error}/>
        {!model&&<p className="lw-hint">Choose a chat model in the title bar to start.</p>}
        <form className="lw-composer" onSubmit={event=>{event.preventDefault();if(prompt.trim())void send(prompt.trim());}}>
          <textarea value={prompt} onChange={event=>setPrompt(event.target.value)} placeholder={pending.length?'Accept or reject the pending changes first.':'Describe a change, ask about the code, or say "run the tests"…'} aria-label="Message the local agent" rows={3} disabled={running||!!pending.length} onKeyDown={event=>{if(event.key==='Enter'&&(event.metaKey||event.ctrlKey)){event.preventDefault();if(prompt.trim())void send(prompt.trim());}}}/>
          <div className="lw-composer-actions">
            <span className="muted">{view.commandsEnabled?'Commands run only after approval.':'Commands are disabled on this API.'}</span>
            {canContinue&&<button type="button" className="button secondary" disabled={!model} onClick={()=>void send()}><Play size={14}/>Continue</button>}
            {running?<button type="button" className="button secondary" onClick={()=>void stop()}><Square size={14}/>Stop</button>:<button className="button primary" disabled={!prompt.trim()||!model||!!pending.length}>Send <kbd>Ctrl ↵</kbd></button>}
          </div>
        </form>
      </section>
    </div>
    <Permissions open={permissionsOpen} onOpenChange={setPermissionsOpen} session={view} onSaved={()=>void refresh()}/>
    <Modal open={!!secretPrompt} onOpenChange={open=>!open&&setSecretPrompt(null)} title="Send a secret file to the model?" description={`${secretPrompt??''} looks like a credential file. Its contents will be sent through your OmniRoute gateway to the selected model.`}>
      <div className="lw-modal-actions"><button className="button secondary" onClick={()=>setSecretPrompt(null)}>Cancel</button><button className="button primary" onClick={()=>{if(secretPrompt)addContext.mutate({path:secretPrompt,allowSecret:true});setSecretPrompt(null);}}>Send this file</button></div>
    </Modal>
  </div>;
}
