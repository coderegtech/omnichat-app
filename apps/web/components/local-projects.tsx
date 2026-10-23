'use client';
import {useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {FolderOpen,MessageSquare,Pin,Plus} from 'lucide-react';
import type {WorkspaceLink,WorkspaceSessionView} from '@omnichat/types';
import {api,errorMessage} from '@/lib/api';
import {ErrorNotice,Field,Menu,MenuItem,Modal} from './ui';

export function LocalProjects({selected,disabled,onSelect,onAdd}:{selected:string|null;disabled:boolean;onSelect:(id:string)=>void;onAdd:()=>void}){
  const client=useQueryClient();const [search,setSearch]=useState('');const [editing,setEditing]=useState<WorkspaceLink|null>(null);
  const [name,setName]=useState('');const [title,setTitle]=useState('');const [path,setPath]=useState('');const [memory,setMemory]=useState('');const [memoryReady,setMemoryReady]=useState(false);
  const links=useQuery({queryKey:['workspace-links'],queryFn:()=>api.request<{items:WorkspaceLink[]}>('/workspace/sessions')});
  const refresh=()=>{void client.invalidateQueries({queryKey:['workspace-links']});void client.invalidateQueries({queryKey:['workspace-session']});};
  const update=useMutation({mutationFn:({id,body}:{id:string;body:unknown})=>api.request(`/workspace/sessions/${id}`,{method:'PATCH',body}),onSuccess:()=>{refresh();setEditing(null);}});
  const create=useMutation({mutationFn:(root:string)=>api.request<WorkspaceSessionView>('/workspace/sessions',{method:'POST',body:{path:root,newChat:true}}),onSuccess:result=>{refresh();onSelect(result.id);}});
  const remove=useMutation({mutationFn:({id,project=false}:{id:string;project?:boolean})=>api.request(`/workspace/sessions/${id}?project=${project}`,{method:'DELETE'}),onSuccess:()=>{refresh();onAdd();}});
  const needle=search.toLowerCase();
  const projects=new Map<string,WorkspaceLink[]>();
  for(const item of links.data?.items??[])if(`${item.name} ${item.root} ${item.title}`.toLowerCase().includes(needle))projects.set(item.root,[...(projects.get(item.root)??[]),item]);
  const edit=async(item:WorkspaceLink)=>{
    setEditing(item);setName(item.name);setTitle(item.title);setPath(item.root);setMemory('');setMemoryReady(false);
    try{const detail=await api.request<WorkspaceSessionView>(`/workspace/sessions/${item.id}`);setMemory(detail.memory);setMemoryReady(true);}catch{/* Missing folders can still be relinked. */}
  };
  return <aside className="lw-projects" aria-label="Local projects and chats">
    <div className="lw-sidebar-heading">PROJECTS & CHATS</div>
    <button className="button secondary" disabled={disabled} onClick={onAdd}><Plus size={14}/>Add Local Project</button>
    <input aria-label="Search projects and chats" placeholder="Search projects and chats" value={search} onChange={event=>setSearch(event.target.value)}/>
    <div className="lw-project-list">{[...projects].map(([root,chats])=><section key={root}>
      <div className="lw-project-title"><FolderOpen size={14}/><strong title={root}>{chats[0]!.name}</strong><button className="icon-button" aria-label={`New chat in ${chats[0]!.name}`} disabled={disabled||create.isPending} onClick={()=>create.mutate(root)}><Plus size={14}/></button></div>
      {chats.map(chat=><div className={`lw-chat-link ${chat.id===selected?'selected':''}`} key={chat.id}><button disabled={disabled} onClick={()=>onSelect(chat.id)}>{chat.pinned?<Pin size={12}/>:<MessageSquare size={12}/>}<span>{chat.title}</span></button><Menu label={`Options for ${chat.title}`}>
        <MenuItem onSelect={()=>void edit(chat)}>Project & chat settings</MenuItem>
        <MenuItem onSelect={()=>update.mutate({id:chat.id,body:{pinned:!chat.pinned}})}>{chat.pinned?'Unpin':'Pin'} chat</MenuItem>
        {typeof window!=='undefined'&&window.omnichatDesktop&&<MenuItem onSelect={()=>void window.omnichatDesktop?.openProjectFolder(root)}>Open folder</MenuItem>}
        <MenuItem danger onSelect={()=>{if(window.confirm(`Remove "${chat.title}" from OmniChat? Source files remain on disk.`))remove.mutate({id:chat.id});}}>Remove chat</MenuItem>
        <MenuItem danger onSelect={()=>{if(window.confirm(`Unlink "${chat.name}" and remove all of its chats from OmniChat? Source files remain on disk.`))remove.mutate({id:chat.id,project:true});}}>Unlink project</MenuItem>
      </Menu></div>)}
    </section>)}</div>
    <ErrorNotice message={[links.error,create.error,update.error,remove.error].filter(Boolean).map(errorMessage).join('\n')}/>
    <Modal open={!!editing} onOpenChange={open=>!open&&setEditing(null)} title="Project & chat settings" description="Project memory is sent to the selected model. Keep credentials out of it. Relinking clears old file context and pending proposals.">
      <Field label="Project name"><input value={name} onChange={event=>setName(event.target.value)}/></Field>
      <Field label="Chat title"><input value={title} onChange={event=>setTitle(event.target.value)}/></Field>
      <Field label="Folder path (on the local API computer)"><input value={path} onChange={event=>setPath(event.target.value)}/></Field>
      <Field label="Project memory and approved instructions"><textarea disabled={!memoryReady} value={memory} onChange={event=>setMemory(event.target.value)} maxLength={8000}/></Field>
      <ErrorNotice message={update.error&&errorMessage(update.error)}/>
      <button className="button primary" disabled={disabled||update.isPending||!name.trim()||!title.trim()||!path.trim()} onClick={()=>editing&&update.mutate({id:editing.id,body:{name,title,...(memoryReady?{memory}:{}),...(path!==editing.root?{path}:{})}})}>Save settings</button>
    </Modal>
  </aside>;
}
