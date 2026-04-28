import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
});

contextBridge.exposeInMainWorld('electronStorage', {
  get: (keys?: any) => ipcRenderer.invoke('storage:get', keys),
  set: (items: any) => ipcRenderer.invoke('storage:set', items),
  remove: (keys: any) => ipcRenderer.invoke('storage:remove', keys),
  onChanged: (callback: (changes: any, areaName: string) => void) => {
    const handler = (_event: any, changes: any, areaName: string) => {
      callback(changes, areaName);
    };
    ipcRenderer.on('storage:changed', handler);
    return () => {
      ipcRenderer.removeListener('storage:changed', handler);
    };
  },
});

contextBridge.exposeInMainWorld('electronDB', {
  request: (action: string, params?: unknown) =>
    ipcRenderer.invoke('db:request', action, params),
  onSync: (callback: (event: any) => void) => {
    const handler = (_ipcEvent: any, syncEvent: any) => callback(syncEvent);
    ipcRenderer.on('db:sync', handler);
    return () => {
      ipcRenderer.removeListener('db:sync', handler);
    };
  },
});

contextBridge.exposeInMainWorld('electronNotes', {
  init: () => ipcRenderer.invoke('notes:init'),
  read: (nodeId: string) => ipcRenderer.invoke('notes:read', nodeId),
  write: (nodeId: string, markdown: string) => ipcRenderer.invoke('notes:write', nodeId, markdown),
  remove: (nodeId: string) => ipcRenderer.invoke('notes:remove', nodeId),
  list: () => ipcRenderer.invoke('notes:list'),
  exists: (nodeId: string) => ipcRenderer.invoke('notes:exists', nodeId),
});

contextBridge.exposeInMainWorld('electronRuntime', {
  sendMessage: (message: any) => ipcRenderer.invoke('runtime:sendMessage', message),
  onMessage: (callback: (message: any) => void) => {
    const handler = (_event: any, message: any) => callback(message);
    ipcRenderer.on('runtime:broadcast', handler);
    return () => {
      ipcRenderer.removeListener('runtime:broadcast', handler);
    };
  },
});

contextBridge.exposeInMainWorld('electronCompanion', {
  onCapture: (callback: (data: { title: string; url: string; content: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('companion:capture', handler);
    return () => {
      ipcRenderer.removeListener('companion:capture', handler);
    };
  },
});
