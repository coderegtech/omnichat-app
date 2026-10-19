import {create} from 'zustand';
export type Workspace = 'projects'|'chat'|'agent'|'models'|'images'|'video'|'music'|'speech'|'transcription'|'search'|'files'|'status';
interface UiState {workspace:Workspace; conversationId:string|null; modelId:string; sidebarOpen:boolean; setWorkspace:(value:Workspace)=>void; selectConversation:(id:string|null)=>void; setModel:(id:string)=>void; toggleSidebar:()=>void; closeSidebar:()=>void;}
export const useUi = create<UiState>((set)=>({
  workspace:'projects',conversationId:null,modelId:'',sidebarOpen:false,
  setWorkspace:(workspace)=>set({workspace,sidebarOpen:false}),
  selectConversation:(conversationId)=>set({conversationId,workspace:'chat',sidebarOpen:false}),
  setModel:(modelId)=>set({modelId}),toggleSidebar:()=>set(s=>({sidebarOpen:!s.sidebarOpen})),closeSidebar:()=>set({sidebarOpen:false})
}));
