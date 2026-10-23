'use client';
import {useCallback,useEffect,useState,type CSSProperties} from 'react';
import {useInfiniteQuery,useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {ActivityBar,CommandPalette,SidebarResize,WorkspacePane,WorkspaceTabs,workspaceLabels,type IdeCommand} from './ide-shell';
import {useCodingIde} from '@/lib/coding-ide-store';
import './ide-shell.css';
import {Activity,ArrowDownToLine,ArrowRight,ArrowUpRight,Check,ChevronDown,ChevronLeft,Command,Folder as FolderIcon,FolderPlus,Globe,Image,Info,Layers3,LogOut,Menu as MenuIcon,MessageSquare,Mic2,MoreHorizontal,Music2,PanelBottom,PanelLeftClose,PanelLeftOpen,Pin,Plus,Search,Settings2,ShieldCheck,SlidersHorizontal,Sparkles,Trash2,UserRound,Video,Waypoints,X} from 'lucide-react';
import type {Conversation,Folder,ListResult,ModelRegistry,User,UserSettings} from '@omnichat/types';
import {ApiError} from '@omnichat/api-client';
import {api,errorMessage} from '@/lib/api';
import {useUi,type Workspace} from '@/lib/store';
import {AuthDialog} from './auth';
import {Chat} from './chat';
import {CodingWorkspace,CodingWelcome} from './coding-workspace';
import {LocalWorkspace} from './local-workspace';
import {ModelBrowser,ModelPicker} from './models';
import {ConversationSettings,SettingsDialog} from './settings';
import {Connection,FilesWorkspace,SearchWorkspace,SignedOutWorkspace,Studio,WorkspaceHeading} from './workspaces';
import {Brand,Busy,ErrorNotice,Field,Menu,MenuItem,Modal} from './ui';

export function OmniChat(){
 useEffect(()=>{const openLink=(event:MouseEvent)=>{if(!window.omnichatDesktop||event.defaultPrevented)return;const link=(event.target as Element)?.closest?.('a[href]') as HTMLAnchorElement|null;if(!link)return;let url:URL;try{url=new URL(link.href);}catch{return;}if(['http:','https:'].includes(url.protocol)&&url.origin!==window.location.origin){event.preventDefault();void window.omnichatDesktop.openExternal(url.href).catch(()=>{});}};document.addEventListener('click',openLink);return()=>document.removeEventListener('click',openLink);},[]);
 const queryClient=useQueryClient();const workspace=useUi(s=>s.workspace);const setWorkspace=useUi(s=>s.setWorkspace);const conversationId=useUi(s=>s.conversationId);const selectConversation=useUi(s=>s.selectConversation);const modelId=useUi(s=>s.modelId);const setModel=useUi(s=>s.setModel);const sidebarOpen=useUi(s=>s.sidebarOpen);const toggleSidebar=useUi(s=>s.toggleSidebar);const closeSidebar=useUi(s=>s.closeSidebar);
 const [collapsed,setCollapsed]=useState(false);const [authOpen,setAuthOpen]=useState(false);const [settingsOpen,setSettingsOpen]=useState(false);const [detailsOpen,setDetailsOpen]=useState(false);const [editingConversation,setEditingConversation]=useState<Conversation|undefined>();const [query,setQuery]=useState('');const [debouncedQuery,setDebouncedQuery]=useState('');const [folderFilter,setFolderFilter]=useState<string|null>(null);const [folderOpen,setFolderOpen]=useState(false);const [folderName,setFolderName]=useState('');const [deleteTarget,setDeleteTarget]=useState<{type:'conversations'|'folders';id:string;name:string}|null>(null);const [actionError,setActionError]=useState<string|null>(null);
 const me=useQuery({queryKey:['me'],queryFn:()=>api.request<{user:User}>('/auth/me'),retry:false});const user=me.data?.user;
 const registry=useQuery({queryKey:['models'],queryFn:()=>api.request<ModelRegistry>('/models'),enabled:!!user,staleTime:60_000});const settings=useQuery({queryKey:['settings'],queryFn:()=>api.request<UserSettings>('/settings'),enabled:!!user});
 const conversations=useInfiniteQuery({queryKey:['conversations',debouncedQuery],initialPageParam:'',queryFn:({pageParam})=>api.request<ListResult<Conversation>>(`/conversations?q=${encodeURIComponent(debouncedQuery)}${pageParam?`&cursor=${encodeURIComponent(pageParam)}`:''}`),getNextPageParam:last=>last.nextCursor||undefined,enabled:!!user});
 const folders=useQuery({queryKey:['folders'],queryFn:()=>api.request<ListResult<Folder>>('/folders'),enabled:!!user});const history=conversations.data?.pages.flatMap(page=>page.items)||[];const current=history.find(c=>c.id===conversationId);const filtered=history.filter(c=>!folderFilter||c.folderId===folderFilter);
 const refresh=useMutation({mutationFn:()=>api.request<ModelRegistry>('/models/refresh',{method:'POST'}),onSuccess:data=>queryClient.setQueryData(['models'],data)});
 const modify=useMutation({mutationFn:({id,...body}:{id:string;pinned?:boolean})=>api.request(`/conversations/${id}`,{method:'PATCH',body}),onSuccess:()=>queryClient.invalidateQueries({queryKey:['conversations']})});
 const createFolder=useMutation({mutationFn:()=>api.request<Folder>('/folders',{method:'POST',body:{name:folderName}}),onSuccess:()=>{setFolderName('');setFolderOpen(false);void queryClient.invalidateQueries({queryKey:['folders']});}});
 const remove=useMutation({mutationFn:()=>api.request(`/${deleteTarget?.type}/${deleteTarget?.id}`,{method:'DELETE'}),onSuccess:()=>{if(deleteTarget?.type==='conversations'&&deleteTarget.id===conversationId)selectConversation(null);if(deleteTarget?.type==='folders'&&folderFilter===deleteTarget.id)setFolderFilter(null);setDeleteTarget(null);void queryClient.invalidateQueries({queryKey:['conversations']});void queryClient.invalidateQueries({queryKey:['folders']});}});
 const logout=useMutation({mutationFn:()=>api.request('/auth/logout',{method:'POST'}),onSuccess:()=>{queryClient.clear();queryClient.setQueryData(['me'],{user:undefined});selectConversation(null);setModel('');}});
 const requireAuth=useCallback(()=>{if(!user){setAuthOpen(true);return false;}return true;},[user]);
 const newChat=useCallback(()=>{selectConversation(null);setFolderFilter(null);if(settings.data?.defaultModel)setModel(settings.data.defaultModel);},[selectConversation,setModel,settings.data]);
 useEffect(()=>{const timer=setTimeout(()=>setDebouncedQuery(query),250);return()=>clearTimeout(timer);},[query]);
 useEffect(()=>{if(!modelId&&settings.data?.defaultModel)setModel(settings.data.defaultModel);},[settings.data,modelId,setModel]);
 useEffect(()=>{const theme=settings.data?.theme||'dark';const media=window.matchMedia('(prefers-color-scheme: dark)');const apply=()=>{document.documentElement.dataset.theme=theme==='system'?(media.matches?'dark':'light'):theme;document.documentElement.dataset.animations=settings.data?.animations===false?'off':'on';};apply();media.addEventListener('change',apply);return()=>media.removeEventListener('change',apply);},[settings.data]);
 useEffect(()=>window.omnichatDesktop?.onNewChat(newChat),[newChat]);
 useEffect(()=>{if(!sidebarOpen)return;const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')closeSidebar();};document.addEventListener('keydown',escape);return()=>document.removeEventListener('keydown',escape);},[sidebarOpen,closeSidebar]);
 const openConversation=(conversation:Conversation)=>{selectConversation(conversation.id);if(conversation.modelId)setModel(conversation.modelId);};
 const exportConversation=async(format:'markdown'|'json')=>{if(!conversationId)return;try{const blob=await api.download(`/conversations/${conversationId}/export?format=${format}`);const name=(current?.title||'Conversation').replace(/[<>:"/\\|?*]/g,'_').slice(0,80);if(window.omnichatDesktop){await window.omnichatDesktop.saveText({name,content:await blob.text(),format});return;}const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=`${name}.${format==='markdown'?'md':'json'}`;anchor.click();URL.revokeObjectURL(url);}catch(error){setActionError(errorMessage(error));}};
 const connection=registry.data?.connection;const greeting=user?.name.split(' ')[0];const isAudio=['music','speech','transcription'].includes(workspace);
 const historyRow=(conversation:Conversation)=><div className={`history-row ${conversation.id===conversationId&&workspace==='chat'?'selected':''}`} key={conversation.id}><button className="history-select" onClick={()=>openConversation(conversation)}>{conversation.pinned?<Pin size={13}/>:<MessageSquare size={13}/>}<span>{conversation.title}</span></button><Menu label={`Options for ${conversation.title}`}><MenuItem onSelect={()=>{setEditingConversation(conversation);setDetailsOpen(true);}}><SlidersHorizontal size={14}/>Rename & settings</MenuItem><MenuItem onSelect={()=>modify.mutate({id:conversation.id,pinned:!conversation.pinned})}><Pin size={14}/>{conversation.pinned?'Unpin conversation':'Pin conversation'}</MenuItem><MenuItem danger onSelect={()=>setDeleteTarget({type:'conversations',id:conversation.id,name:conversation.title})}><Trash2 size={14}/>Delete conversation</MenuItem></Menu></div>;

 const coding=useCodingIde();
 const [sidebarWidth,setSidebarWidth]=useState(258);
 const [palette,setPalette]=useState<'commands'|'files'|null>(null);
 const [tabs,setTabs]=useState<Workspace[]>(['agent']);
 const [mounted,setMounted]=useState<Workspace[]>(['agent']);
 useEffect(()=>{setTabs(items=>items.includes(workspace)?items:[...items,workspace]);setMounted(items=>items.includes(workspace)?items:[...items,workspace]);},[workspace]);
 useEffect(()=>{
   const activeWorkspace=useUi.getState().workspace;
   const initial:Workspace[]=activeWorkspace==='agent'?['agent']:['agent',activeWorkspace];
   setTabs(initial);setMounted(initial);setQuery('');setDebouncedQuery('');setFolderFilter(null);
   setDetailsOpen(false);setEditingConversation(undefined);setDeleteTarget(null);setFolderOpen(false);
   setSettingsOpen(false);setPalette(null);setActionError(null);setFolderName('');
 },[user?.id]);
 const closeView=useCallback((id:Workspace)=>{if(id==='agent')return;setTabs(items=>items.filter(item=>item!==id));if(workspace===id)setWorkspace('agent');},[workspace,setWorkspace]);
 const toggleContextSidebar=useCallback(()=>{if(workspace==='projects')useCodingIde.getState().toggleExplorer();else setCollapsed(value=>!value);},[workspace]);
 useEffect(()=>{
   const keydown=(event:KeyboardEvent)=>{
     if(!(event.ctrlKey||event.metaKey)||event.altKey)return;
     const key=event.key.toLowerCase();
     if(document.querySelector('[role="dialog"]'))return;
     if(key==='p'){event.preventDefault();setPalette(event.shiftKey?'commands':'files');return;}
     if(key==='b'&&(workspace==='chat'||(workspace==='projects'&&useCodingIde.getState().ready))){event.preventDefault();toggleContextSidebar();}
     else if(key==='j'&&workspace==='projects'&&useCodingIde.getState().ready){event.preventDefault();useCodingIde.getState().togglePanel();}
     else if(key==='k'&&!event.shiftKey){event.preventDefault();newChat();}
     // Browser Ctrl+W remains browser-owned. Electron can safely close an internal tab.
     else if(key==='w'&&window.omnichatDesktop){event.preventDefault();if(workspace==='projects')useCodingIde.getState().closeActiveFile();else closeView(workspace);}
   };
   window.addEventListener('keydown',keydown);return()=>window.removeEventListener('keydown',keydown);
 },[newChat,workspace,closeView,toggleContextSidebar]);
 const commands:IdeCommand[]=[
   {id:'project',label:'View: Projects',run:()=>setWorkspace('agent')},
   {id:'saved-projects',label:'View: Saved projects',run:()=>setWorkspace('projects')},
   {id:'chat',label:'Chat: New conversation',shortcut:'Ctrl / ⌘ K',run:newChat},
   {id:'history',label:'View: Conversation history',run:()=>{setWorkspace('chat');setCollapsed(false);}},
   {id:'models',label:'AI: Browse models and providers',run:()=>setWorkspace('models')},
   {id:'connection',label:'AI: Gateway connection',run:()=>setWorkspace('status')},
   ...(workspace==='chat'||(workspace==='projects'&&coding.ready)?[{id:'sidebar',label:'View: Toggle sidebar',shortcut:'Ctrl / ⌘ B',run:toggleContextSidebar}]:[]),
   {id:'settings',label:'Preferences: Open settings',run:()=>requireAuth()&&setSettingsOpen(true)},
   ...(['images','video','music','search','files'] as Workspace[]).map(id=>({id,label:`View: ${workspaceLabels[id]}`,run:()=>setWorkspace(id)})),
   ...(coding.ready?[
     {id:'quick',label:'File: Quick open',shortcut:'Ctrl / ⌘ P',run:()=>setPalette('files')},
     {id:'search-project',label:'Search: Current project files',run:()=>{setWorkspace('projects');coding.showSearch();}},
     {id:'save',label:'File: Save active file to workspace',shortcut:'Ctrl / ⌘ S',run:()=>{setWorkspace('projects');coding.saveFile();}},
     {id:'terminal',label:'Panel: Approved sandbox commands',run:()=>{setWorkspace('projects');coding.showTerminal();}},
     {id:'changes',label:'Panel: Review proposed changes',run:()=>{setWorkspace('projects');coding.showChanges();}},
     {id:'panel',label:'View: Toggle bottom panel',shortcut:'Ctrl / ⌘ J',run:()=>{setWorkspace('projects');coding.togglePanel();}},
     {id:'close-file',label:'File: Close active editor tab',run:()=>coding.closeActiveFile()},
   ]:[]),
 ];
 const quickFiles:IdeCommand[]=coding.files.map(file=>({id:file.path,label:file.path,detail:coding.projectName,run:()=>{setWorkspace('projects');coding.openFile(file.path);}}));
 const connectionLabel=!user?'Sign in to connect':connection?.status==='connected'?'Gateway connected':connection?.status==='unconfigured'?'Gateway not configured':connection?.status==='disconnected'?'Gateway disconnected':'Checking connection';
 const selectedModel=registry.data?.models.find(model=>model.id===modelId);
 const extraWorkspace=(id:Workspace)=>!user?<SignedOutWorkspace onSignIn={()=>setAuthOpen(true)}/>:id==='models'?<div className="workspace-content"><WorkspaceHeading eyebrow="OMNIROUTE INTEGRATIONS" title="Find your thinking partner." description="Models and capabilities reported by your connected gateway." action={<button className="button secondary" onClick={()=>refresh.mutate()} disabled={refresh.isPending}>Refresh discovery</button>}/><ErrorNotice message={registry.error&&errorMessage(registry.error)}/><ModelBrowser registry={registry.data} settings={settings.data} onSelect={()=>setWorkspace('chat')}/></div>:id==='status'?<Connection registry={registry.data} refreshing={refresh.isPending||registry.isFetching} onRefresh={()=>refresh.mutate()} error={refresh.error||registry.error}/>:id==='agent'?<LocalWorkspace registry={registry.data}/>:id==='files'?<FilesWorkspace/>:id==='search'?<SearchWorkspace registry={registry.data}/>:<div className="studio-container">{['music','speech','transcription'].includes(id)&&<div className="studio-tabs">{(['music','speech','transcription'] as const).map(kind=><button className={id===kind?'active':''} onClick={()=>setWorkspace(kind)} key={kind}>{workspaceLabels[kind]}</button>)}</div>}<Studio kind={id as 'images'|'video'|'music'|'speech'|'transcription'} registry={registry.data}/></div>;
 return <div className="ide-shell" style={{'--conversation-sidebar-width':`${sidebarWidth}px`} as CSSProperties}>
   <a className="skip-link" href="#main-content">Skip to content</a>
   <header className="ide-titlebar">
     <button className="icon-button ide-mobile-menu" aria-label="Open navigation" onClick={toggleSidebar}><MenuIcon size={18}/></button>
     <button className="ide-brand" aria-label="OmniChat home" onClick={()=>setWorkspace('projects')}><Brand small/><strong>OmniChat</strong><span> / OmniRoute</span></button>
     <button className="ide-command-entry" aria-label="Open command palette" title="Command palette (Ctrl/Cmd+Shift+P)" onClick={()=>setPalette('commands')}><Search size={14}/><span>{workspace==='projects'&&coding.projectName||'Search commands'}</span><kbd>⌘ / Ctrl ⇧ P</kbd></button>
     <div className="ide-title-actions"><ModelPicker registry={registry.data} settings={settings.data} requireAuth={requireAuth}/>{(workspace==='chat'||(workspace==='projects'&&coding.ready))&&<button className="icon-button" aria-label="Toggle sidebar" title="Toggle sidebar (Ctrl/Cmd+B)" onClick={toggleContextSidebar}><PanelLeftOpen size={16}/></button>}{workspace==='projects'&&coding.ready&&<button className="icon-button" aria-label="Toggle bottom panel" title="Toggle bottom panel (Ctrl/Cmd+J)" onClick={coding.togglePanel}><PanelBottom size={16}/></button>}{user?<Menu label="Account options"><MenuItem onSelect={()=>setSettingsOpen(true)}><Settings2 size={14}/>Preferences</MenuItem><MenuItem onSelect={()=>logout.mutate()}><LogOut size={14}/>Sign out</MenuItem></Menu>:<button className="button sign-in-button" onClick={()=>setAuthOpen(true)}>Sign in</button>}</div>
   </header>
   <div className="ide-body">
     {sidebarOpen&&<button className="ide-drawer-backdrop" aria-label="Close navigation backdrop" onClick={closeSidebar}/>}
     <ActivityBar workspace={workspace} navigate={setWorkspace} mobileOpen={sidebarOpen} onClose={closeSidebar} onSearch={coding.ready?()=>{setWorkspace('projects');coding.showSearch();}:undefined} onSettings={()=>requireAuth()&&setSettingsOpen(true)} onConnection={()=>setWorkspace('status')}/>
     {workspace==='chat'&&!collapsed&&<aside className="ide-conversations" aria-label="Conversation sidebar"><div className="ide-sidebar-heading"><strong>CONVERSATIONS</strong><button className="icon-button" title="Collapse sidebar" aria-label="Collapse sidebar" onClick={()=>setCollapsed(true)}><PanelLeftClose size={15}/></button></div><button className="new-chat button" onClick={newChat}><Plus size={15}/>New chat<kbd>Ctrl / ⌘ K</kbd></button>
<div className="history-section"><div className="sidebar-section-label"><span>YOUR CONVERSATIONS</span><button className="icon-button" aria-label="Create folder" onClick={()=>{if(requireAuth())setFolderOpen(true);}}><FolderPlus size={14}/></button></div>{user?<><div className="sidebar-search"><Search size={14}/><input placeholder="Search conversations" aria-label="Search conversations" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button className="icon-button" aria-label="Clear conversation search" onClick={()=>setQuery('')}><X size={12}/></button>}</div>{!!folders.data?.items.length&&<div className="folders">{folders.data.items.map(folder=><div className={`folder-row ${folderFilter===folder.id?'selected':''}`} key={folder.id}><button onClick={()=>setFolderFilter(folderFilter===folder.id?null:folder.id)}><FolderIcon size={13}/>{folder.name}</button><Menu label={`Folder ${folder.name} options`}><MenuItem danger onSelect={()=>setDeleteTarget({type:'folders',id:folder.id,name:folder.name})}><Trash2 size={14}/>Delete folder</MenuItem></Menu></div>)}</div>}<div className="history-list">{filtered.some(c=>c.pinned)&&<span className="history-group">PINNED</span>}{filtered.filter(c=>c.pinned).map(historyRow)}{filtered.some(c=>!c.pinned)&&<span className="history-group">RECENT</span>}{filtered.filter(c=>!c.pinned).map(historyRow)}{conversations.isPending&&<div className="history-loading"><Busy label="Loading conversations"/></div>}{!conversations.isPending&&!filtered.length&&<p className="history-empty">{query?'No conversations found.':'Your next great idea starts with a conversation.'}</p>}{conversations.hasNextPage&&<button className="text-button load-more" onClick={()=>void conversations.fetchNextPage()} disabled={conversations.isFetchingNextPage}>Load more conversations</button>}</div><ErrorNotice message={(conversations.error||modify.error)&&errorMessage(conversations.error||modify.error)}/></>:<div className="guest-history"><div className="history-illustration"><MessageSquare size={20}/><span/><span/></div><p>Good ideas deserve<br/>a place to come back to.</p><button onClick={requireAuth}>Sign in to save your chats <ArrowRight size={13}/></button></div>}</div>
       <SidebarResize width={sidebarWidth} onChange={setSidebarWidth}/>
     </aside>}
     <main className="ide-main" id="main-content">
       <WorkspaceTabs tabs={tabs} active={workspace} onSelect={setWorkspace} onClose={closeView}/>
 {actionError&&<div className="global-notice"><ErrorNotice message={actionError}/><button className="icon-button" aria-label="Dismiss error" onClick={()=>setActionError(null)}><X size={14}/></button></div>}{me.error&&!(me.error instanceof ApiError&&me.error.status===401)&&<div className="global-notice"><ErrorNotice message={`The application server could not be reached. ${errorMessage(me.error)}`}/><button className="text-button" onClick={()=>void me.refetch()}>Retry</button></div>}

       {workspace==='chat'&&<div className="ide-chat-heading"><div><MessageSquare size={15}/><strong>{current?.title||'New conversation'}</strong><span>{selectedModel?.provider||'Choose a model'}</span></div><div><button className="icon-button" aria-label="Show conversation history" title="Show conversation history" onClick={()=>setCollapsed(false)}><HistoryIcon/></button>{conversationId&&<><button className="icon-button" aria-label="Conversation details" title="Conversation details" onClick={()=>{setEditingConversation(current);setDetailsOpen(true);}}><SlidersHorizontal size={16}/></button><Menu label="Export conversation"><MenuItem onSelect={()=>void exportConversation('markdown')}><ArrowDownToLine size={14}/>Export Markdown</MenuItem><MenuItem onSelect={()=>void exportConversation('json')}><ArrowDownToLine size={14}/>Export JSON</MenuItem></Menu></>}</div></div>}
       {mounted.includes('projects')&&<WorkspacePane active={workspace==='projects'}>{user?<CodingWorkspace key={user.id} registry={registry.data} visible={workspace==='projects'}/>:<CodingWelcome onSignIn={()=>setAuthOpen(true)}/>}</WorkspacePane>}
       {mounted.includes('chat')&&<WorkspacePane active={workspace==='chat'}><Chat user={user} registry={registry.data} settings={settings.data} requireAuth={requireAuth} visible={workspace==='chat'}/></WorkspacePane>}
       {mounted.filter(id=>id!=='projects'&&id!=='chat').map(id=><WorkspacePane key={id} active={workspace===id}>{extraWorkspace(id)}</WorkspacePane>)}
     </main>
   </div>
   <footer className="ide-statusbar" aria-label="Workspace status"><button onClick={()=>user?setWorkspace('status'):setAuthOpen(true)}><span className={`status-orb ${connection?.status==='connected'?'online':''}`}/>{connectionLabel}</button><span className="status-workspace">{workspace==='projects'&&coding.projectName||workspaceLabels[workspace]}</span><div className="status-spacer"/>{workspace==='projects'&&coding.ready&&<><span className="status-file" title={coding.activeFile||''}>{coding.activeFile||'No file selected'}</span>{coding.activeFile&&<span className="status-cursor">Ln {coding.cursor.line}, Col {coding.cursor.column} · {coding.language}</span>}<span>{coding.dirtyCount?`${coding.dirtyCount} unsaved`:'Workspace saved'}</span></>}<span className="status-provider" title={selectedModel?.id}>{selectedModel?`${selectedModel.provider} / ${selectedModel.name}`:'No model selected'}</span></footer>
   <CommandPalette mode={palette} onClose={()=>setPalette(null)} commands={commands} files={quickFiles}/>
<AuthDialog open={authOpen} onOpenChange={setAuthOpen}/><SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} settings={settings.data} registry={registry.data}/><ConversationSettings open={detailsOpen} onOpenChange={setDetailsOpen} conversation={editingConversation} registry={registry.data} folders={folders.data?.items||[]}/><Modal open={folderOpen} onOpenChange={setFolderOpen} title="A place for related ideas" description="Create a folder to organize your conversations."><form className="stack" onSubmit={e=>{e.preventDefault();createFolder.mutate();}}><Field label="Folder name"><input autoFocus value={folderName} onChange={e=>setFolderName(e.target.value)} placeholder="e.g. Weekend projects" maxLength={80} required/></Field><ErrorNotice message={createFolder.error&&errorMessage(createFolder.error)}/><button className="button primary" disabled={createFolder.isPending}>{createFolder.isPending?<Busy label="Creating"/>:'Create folder'}</button></form></Modal><Modal open={!!deleteTarget} onOpenChange={v=>!v&&setDeleteTarget(null)} title={`Delete ${deleteTarget?.type==='folders'?'folder':'conversation'}?`} description={deleteTarget?.type==='folders'?'Conversations will be kept outside this folder.':'This conversation and its branches will be removed from your history.'}><p className="delete-name">{deleteTarget?.name}</p><ErrorNotice message={remove.error&&errorMessage(remove.error)}/><div className="dialog-footer"><button className="button secondary" onClick={()=>setDeleteTarget(null)}>Keep it</button><button className="button danger-button" disabled={remove.isPending} onClick={()=>remove.mutate()}>{remove.isPending?<Busy label="Deleting"/>:'Delete'}</button></div></Modal>

 </div>;
}
function HistoryIcon(){return <MessageSquare size={16}/>;}
