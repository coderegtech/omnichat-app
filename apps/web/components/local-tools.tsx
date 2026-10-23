'use client';
import {useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import type {WorkspaceSessionView} from '@omnichat/types';
import {api,errorMessage} from '@/lib/api';
import {CodingEditor} from './coding-editor';
import {Busy,ErrorNotice,Modal,Select} from './ui';
import {LocalTerminal} from './local-terminal';

export type LocalDrafts=Map<string,{before:string;after:string}>;
export function LocalTools({session,path,onPath,files,drafts}:{session:WorkspaceSessionView;path:string|null;onPath:(path:string)=>void;files:React.ReactNode;drafts:LocalDrafts}){
  const [tab,setTab]=useState<'files'|'search'|'git'|'terminal'>('files');
  const [query,setQuery]=useState('');const [search,setSearch]=useState('');
  const matches=useQuery({queryKey:['workspace-search',session.id,search],enabled:!!search,queryFn:()=>api.request<{matches:{path:string;line:number;text:string}[];limited:boolean}>(`/workspace/sessions/${session.id}/search?query=${encodeURIComponent(search)}`)});
  return <aside className="lw-tools" aria-label="Development tools">
    <div className="lw-panel-toolbar" role="tablist" aria-label="Development panels">{(['files','search','git','terminal'] as const).map(value=><button key={value} role="tab" aria-selected={tab===value} className={tab===value?'active':''} onClick={()=>setTab(value)}>{value[0]!.toUpperCase()+value.slice(1)}</button>)}</div>
    {tab==='files'&&<>{files}{path&&<LocalFile key={session.id+path} session={session} path={path} drafts={drafts}/>}</>}
    {tab==='search'&&<><form className="lw-panel-toolbar" onSubmit={event=>{event.preventDefault();setSearch(query.trim());}}><input aria-label="Search source files" placeholder="Search source text" value={query} onChange={event=>setQuery(event.target.value)}/><button className="button secondary">Search</button></form><ErrorNotice message={matches.error&&errorMessage(matches.error)}/>{matches.isFetching&&<Busy/>}<div className="lw-search-results">{matches.data?.matches.map((item,index)=><button key={index} onClick={()=>{onPath(item.path);setTab('files');}}><strong>{item.path}:{item.line}</strong><code>{item.text}</code></button>)}{matches.data?.limited&&<p>Results limited; narrow your search.</p>}</div></>}
    {tab==='git'&&<LocalGit session={session}/>}
    {tab==='terminal'&&<LocalTerminal session={session}/>}
  </aside>;
}

function LocalFile({session,path,drafts}:{session:WorkspaceSessionView;path:string;drafts:LocalDrafts}){
  const draftKey=session.root+'/'+path;
  const client=useQueryClient();const [draft,setDraft]=useState<string|null>(drafts.get(draftKey)?.after??null);const [review,setReview]=useState(false);
  const file=useQuery({queryKey:['workspace-file',session.id,path],queryFn:()=>api.request<{content:string;truncated:boolean}>(`/workspace/sessions/${session.id}/file?path=${encodeURIComponent(path)}`)});
  const save=useMutation({mutationFn:()=>api.request(`/workspace/sessions/${session.id}/file`,{method:'POST',body:{path,before:drafts.get(draftKey)?.before??file.data?.content,after:draft}}),onSuccess:async()=>{await client.invalidateQueries({queryKey:['workspace-file',session.id,path]});setReview(false);setDraft(null);drafts.delete(draftKey);void client.invalidateQueries({queryKey:['workspace-session',session.id]});}});
  const editable=session.mode==='agent'&&!file.data?.truncated&&!session.running;
  return <div className="lw-file"><div className="lw-panel-toolbar"><code>{path}</code><button className="button secondary" disabled={!editable||draft===null||draft===file.data?.content} onClick={()=>setReview(true)}>Review & save</button></div>
    <ErrorNotice message={file.error&&errorMessage(file.error)}/>{file.isLoading&&<Busy/>}
    {file.data&&<CodingEditor path={path} value={draft??file.data.content} onChange={after=>{setDraft(after);const before=drafts.get(draftKey)?.before??file.data!.content;if(after===before)drafts.delete(draftKey);else drafts.set(draftKey,{before,after});}} onCursorChange={()=>{}} readOnly={!editable}/>}
    {file.data?.truncated&&<p className="muted">File preview is truncated; editing is disabled.</p>}
    <Modal open={review} onOpenChange={setReview} title={`Save ${path}?`} description="Compare the original and edited contents. Saving writes to the original file and fails if another process changed it.">
      <div className="lw-compare"><section><strong>Original</strong><CodingEditor path={path} value={drafts.get(draftKey)?.before??file.data?.content??''} readOnly onChange={()=>{}} onCursorChange={()=>{}}/></section><section><strong>Modified</strong><CodingEditor path={path} value={draft??''} readOnly onChange={()=>{}} onCursorChange={()=>{}}/></section></div>
      <ErrorNotice message={save.error&&errorMessage(save.error)}/><button className="button primary" disabled={save.isPending} onClick={()=>save.mutate()}>Accept & save</button>
    </Modal>
  </div>;
}

function LocalGit({session}:{session:WorkspaceSessionView}){
  const client=useQueryClient();const [kind,setKind]=useState('status');const [action,setAction]=useState('stage');const [value,setValue]=useState('');const [review,setReview]=useState(false);const [revision,setRevision]=useState('');const [diffPath,setDiffPath]=useState('');
  const git=useQuery({queryKey:['workspace-git',session.id,kind,revision,diffPath],enabled:kind!=='compare'||/^[a-f0-9]{7,40}$/i.test(revision),queryFn:()=>api.request<{output:string}>(`/workspace/sessions/${session.id}/git?kind=${kind}${kind==='compare'?`&revision=${revision}`:''}${diffPath&&['diff','compare'].includes(kind)?`&path=${encodeURIComponent(diffPath)}`:''}`)});
  const mutate=useMutation({mutationFn:()=>api.request<{output:string}>(`/workspace/sessions/${session.id}/git`,{method:'POST',body:{action,...(value?{value}:{}),approved:true}}),onSuccess:()=>{setReview(false);setValue('');void client.invalidateQueries({queryKey:['workspace-git',session.id]});void client.invalidateQueries({queryKey:['workspace-session',session.id]});}});
  const needsValue=!['push','pull'].includes(action);
  return <div className="lw-git"><div className="lw-panel-toolbar"><Select label="Git view" value={kind} onChange={setKind}><option value="status">Status & branch</option><option value="diff">Working & staged diff</option><option value="log">Commit history</option><option value="branches">Branches</option><option value="compare">Compare commit with HEAD</option></Select><button className="button secondary" onClick={()=>void git.refetch()}>Refresh</button></div>
    {kind==='compare'&&<div className="lw-panel-toolbar"><input aria-label="Base commit hash" placeholder="Commit hash from history" value={revision} onChange={event=>setRevision(event.target.value)}/></div>}
    {['diff','compare'].includes(kind)&&<div className="lw-panel-toolbar"><input aria-label="Diff file filter" placeholder="Relative file path (optional)" value={diffPath} onChange={event=>setDiffPath(event.target.value)}/></div>}
    {kind==='status'&&<div className="lw-search-results">{git.data?.output.split('\n').filter(line=>line.length>3&&!line.startsWith('##')).map(line=><button key={line} onClick={()=>{const path=line.slice(3).replace(/^"|"$/g,'');setDiffPath(path);setValue(path);setKind('diff');}}>{line}</button>)}</div>}
    <ErrorNotice message={git.error&&errorMessage(git.error)}/>{git.isFetching&&<Busy/>}<pre className="lw-output">{git.data?.output||'No changes.'}</pre>
    <form className="lw-git-actions" onSubmit={event=>{event.preventDefault();setReview(true);}}>
      <Select label="Git action" value={action} onChange={setAction}><option value="stage">Stage file</option><option value="unstage">Unstage file</option><option value="commit">Commit staged changes</option><option value="create-branch">Create branch</option><option value="switch-branch">Switch branch</option><option value="push">Push</option><option value="pull">Pull (fast-forward only)</option></Select>
      {needsValue&&<input aria-label="Git action value" value={value} onChange={event=>setValue(event.target.value)} placeholder={action==='commit'?'Commit message':action.includes('branch')?'Branch name':'Relative file path'}/>}
      <button className="button secondary" disabled={!session.commandsEnabled||session.mode!=='agent'||session.running||(needsValue&&!value.trim())}>Review Git action</button>
    </form>
    <Modal open={review} onOpenChange={setReview} title={`Git: ${action}`} description={`Apply this Git operation to ${session.root}? Push sends committed content to the configured remote. Pull updates files; branch changes require a clean working tree.`}>
      <pre>{action} {value}</pre><ErrorNotice message={mutate.error&&errorMessage(mutate.error)}/><button className="button primary" disabled={mutate.isPending} onClick={()=>mutate.mutate()}>Approve {action}</button>
    </Modal>
  </div>;
}
