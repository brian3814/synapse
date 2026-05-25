import { contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('electronIPC', {
  invoke: (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args),
  on: (channel: string, cb: (...args: any[]) => void) => {
    const handler = (_event: any, ...args: any[]) => cb(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
  // File.path is deprecated and broken on macOS in Electron 30+.
  // webUtils.getPathForFile is the replacement but must be called from preload.
  // See: https://github.com/electron/electron/issues/43534
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
});
