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
