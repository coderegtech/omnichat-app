import { contextBridge, ipcRenderer } from 'electron';

// Do not expose ipcRenderer, generic invoke/send, Node, paths, or the Electron event object.
contextBridge.exposeInMainWorld('omnichatDesktop', Object.freeze({
  platform: process.platform,
  saveText: (value: { name: string; content: string; format: 'markdown' | 'json' }) => ipcRenderer.invoke('omnichat:save-text', value),
  notify: (value: { title: string; body: string }) => ipcRenderer.invoke('omnichat:notify', value),
  setLaunchOnStartup: (enabled: boolean) => ipcRenderer.invoke('omnichat:launch-on-startup', enabled),
  openExternal: (url: string) => ipcRenderer.invoke('omnichat:open-external', url),
  onNewChat: (listener: () => void) => {
    const handler = () => listener();
    ipcRenderer.on('omnichat:new-chat', handler);
    return () => ipcRenderer.removeListener('omnichat:new-chat', handler);
  },
}));
