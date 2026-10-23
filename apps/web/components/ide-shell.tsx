'use client';

import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Bot,Command,Files,FolderOpen,Globe,Image,Layers3,MessageSquare,Music2,Search,Settings2,Video,Waypoints,X} from 'lucide-react';
import type {Workspace} from '@/lib/store';
import {Modal} from './ui';
import * as Dialog from '@radix-ui/react-dialog';

export const workspaceLabels:Record<Workspace,string>={projects:'Saved projects',chat:'Chat',agent:'Projects',models:'Models',images:'Image studio',video:'Video studio',music:'Audio studio',speech:'Text to speech',transcription:'Transcription',search:'Web search',files:'Your files',status:'Connection'};
const activities=[
  {id:'agent',icon:FolderOpen,label:'Projects'},
  {id:'chat',icon:MessageSquare,label:'Chat'},
  {id:'projects',icon:Files,label:'Saved projects'},
  {id:'models',icon:Layers3,label:'Models'},
  {id:'images',icon:Image,label:'Image studio'},
  {id:'video',icon:Video,label:'Video studio'},
  {id:'music',icon:Music2,label:'Audio studio'},
  {id:'search',icon:Globe,label:'Web search'},
  {id:'files',icon:Files,label:'Your files'},
] as const;

export function ActivityBar({workspace,navigate,onSearch,onSettings,onConnection,mobileOpen,onClose}:{workspace:Workspace;navigate:(workspace:Workspace)=>void;onSearch?:()=>void;onSettings:()=>void;onConnection:()=>void;mobileOpen:boolean;onClose:()=>void}) {
  const select=(id:Workspace)=>{navigate(id);onClose();};
  const navigation=<nav className={`ide-activity ${mobileOpen?'is-open':''}`} aria-label="Main navigation">
    <div className="activity-mobile-heading"><strong>Workspace</strong><button className="icon-button" aria-label="Close navigation" onClick={onClose}><X size={18}/></button></div>
    {activities.slice(0,3).map(item=><button key={item.id} className={workspace===item.id?'active':''} aria-label={item.label} aria-current={workspace===item.id?'page':undefined} title={item.label} onClick={()=>select(item.id)}><item.icon size={21}/><span>{item.label}</span></button>)}
    {onSearch&&<button aria-label="Search project files" title="Search project files" onClick={()=>{onSearch();onClose();}}><Search size={21}/><span>Search project files</span></button>}
    <div className="activity-divider"/>
    {activities.slice(3).map(item=><button key={item.id} className={workspace===item.id?'active':''} aria-label={item.label} aria-current={workspace===item.id?'page':undefined} title={item.label} onClick={()=>select(item.id)}><item.icon size={20}/><span>{item.label}</span></button>)}
    <div className="activity-spacer"/>
    <button aria-label="Gateway connection" title="OmniRoute connection" onClick={()=>{onConnection();onClose();}} className={workspace==='status'?'active':''}><Waypoints size={20}/><span>Connection</span></button>
    <button aria-label="Open preferences" title="Preferences" onClick={()=>{onSettings();onClose();}}><Settings2 size={20}/><span>Preferences</span></button>
  </nav>;
  if(!mobileOpen)return navigation;
  return <Dialog.Root open onOpenChange={open=>!open&&onClose()}><Dialog.Portal><Dialog.Overlay className="ide-drawer-backdrop"/><Dialog.Content className="ide-navigation-dialog"><Dialog.Title className="sr-only">Workspace navigation</Dialog.Title><Dialog.Description className="sr-only">Choose a workspace view or open preferences.</Dialog.Description>{navigation}</Dialog.Content></Dialog.Portal></Dialog.Root>;
}

export function WorkspaceTabs({tabs,active,onSelect,onClose}:{tabs:Workspace[];active:Workspace;onSelect:(id:Workspace)=>void;onClose:(id:Workspace)=>void}) {
  return <div className="ide-workspace-tabs" role="tablist" aria-label="Workspace views">{tabs.map((id,index)=><div className={`workspace-tab ${id===active?'active':''}`} key={id}><button role="tab" tabIndex={id===active?0:-1} aria-selected={id===active} onClick={()=>onSelect(id)} onKeyDown={event=>{let next=index;if(event.key==='ArrowRight')next=(index+1)%tabs.length;else if(event.key==='ArrowLeft')next=(index-1+tabs.length)%tabs.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=tabs.length-1;else return;event.preventDefault();onSelect(tabs[next]!);event.currentTarget.parentElement?.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();}}>{id==='agent'?<FolderOpen size={14}/>:id==='chat'?<MessageSquare size={14}/>:id==='projects'?<Files size={14}/>:<Layers3 size={14}/>}<span>{workspaceLabels[id]}</span></button>{id!=='agent'&&<button className="tab-close" aria-label={`Close ${workspaceLabels[id]} view`} title="Close view" onClick={()=>onClose(id)}><X size={13}/></button>}</div>)}</div>;
}

export type IdeCommand={id:string;label:string;detail?:string;shortcut?:string;run:()=>void};
export function CommandPalette({mode,onClose,commands,files}:{mode:'commands'|'files'|null;onClose:()=>void;commands:IdeCommand[];files:IdeCommand[]}) {
  const [query,setQuery]=useState('');const [selected,setSelected]=useState(0);
  const options=(mode==='files'?files:commands).filter(item=>`${item.label} ${item.detail||''}`.toLowerCase().includes(query.toLowerCase()));
  useEffect(()=>{setQuery('');setSelected(0);},[mode]);
  useEffect(()=>{setSelected(0);},[query]);
  const run=(item:IdeCommand)=>{onClose();item.run();};
  return <Modal open={mode!==null} onOpenChange={open=>!open&&onClose()} title={mode==='files'?'Quick open':'Command palette'} description={mode==='files'?'Search files in the current project.':'Search available workspace actions.'}>
    <div className="command-palette"><div className="palette-input"><Command size={16}/><input autoFocus role="combobox" aria-label={mode==='files'?'Find a project file':'Search commands'} aria-expanded="true" aria-controls="palette-options" aria-activedescendant={options.length?`palette-option-${selected}`:undefined} autoComplete="off" value={query} placeholder={mode==='files'?'Type a file name…':'Type a command…'} onChange={event=>setQuery(event.target.value)} onKeyDown={event=>{if(event.key==='ArrowDown'){event.preventDefault();setSelected(index=>(index+1)%Math.max(1,options.length));}else if(event.key==='ArrowUp'){event.preventDefault();setSelected(index=>(index-1+Math.max(1,options.length))%Math.max(1,options.length));}else if(event.key==='Enter'&&options[selected]){event.preventDefault();run(options[selected]);}}}/></div>
      <div className="palette-options" id="palette-options" role="listbox">{options.map((item,index)=><button role="option" aria-selected={selected===index} id={`palette-option-${index}`} className={selected===index?'selected':''} key={item.id} onMouseMove={()=>setSelected(index)} onClick={()=>run(item)} ref={element=>{if(element&&selected===index)element.scrollIntoView({block:'nearest'});}}><span>{item.label}{item.detail&&<small>{item.detail}</small>}</span>{item.shortcut&&<kbd>{item.shortcut}</kbd>}</button>)}{!options.length&&<p>{mode==='files'&&!files.length?'Open a project to search its files.':'No matching commands or files.'}</p>}</div>
      <div className="palette-help"><span>↑ ↓ to navigate</span><span>Enter to select</span><span>Esc to close</span></div>
    </div>
  </Modal>;
}

export function SidebarResize({width,onChange}:{width:number;onChange:(width:number)=>void}) {
  const start=useRef<{x:number;width:number}|null>(null);
  return <div className="ide-sidebar-resize" role="separator" aria-label="Resize conversation sidebar" aria-orientation="vertical" aria-valuemin={210} aria-valuemax={420} aria-valuenow={width} tabIndex={0} onKeyDown={event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();onChange(Math.max(210,Math.min(420,width+(event.key==='ArrowRight'?16:-16))));}}} onPointerDown={event=>{start.current={x:event.clientX,width};event.currentTarget.setPointerCapture(event.pointerId);event.preventDefault();}} onPointerMove={event=>{if(start.current)onChange(Math.max(210,Math.min(420,start.current.width+event.clientX-start.current.x)));}} onPointerUp={event=>{start.current=null;event.currentTarget.releasePointerCapture(event.pointerId);}} onPointerCancel={()=>{start.current=null;}}/>;
}

export function WorkspacePane({active,children}:{active:boolean;children:ReactNode}) {return <section className="ide-workspace-pane" hidden={!active} aria-hidden={!active}>{children}</section>;}
