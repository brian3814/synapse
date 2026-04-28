type Listener = (...args: any[]) => any;

const tabsStub = {
  query: (_queryInfo: any) => Promise.resolve([]),
  sendMessage: (_tabId: number, _message: any) => Promise.resolve(null),
  create: (_props: any) => Promise.resolve({ id: 0 }),
};

export function installChromeStubs(): void {
  if (typeof globalThis.chrome?.runtime?.id === 'string') {
    return;
  }

  const eStorage = (window as any).electronStorage as {
    get: (keys?: any) => Promise<Record<string, any>>;
    set: (items: any) => Promise<void>;
    remove: (keys: any) => Promise<void>;
    onChanged: (cb: (changes: any, areaName: string) => void) => () => void;
  } | undefined;

  const eRuntime = (window as any).electronRuntime as {
    sendMessage: (message: any) => Promise<any>;
    onMessage: (cb: (message: any) => void) => () => void;
  } | undefined;

  // Storage stubs
  const changeListeners: Listener[] = [];

  if (eStorage) {
    eStorage.onChanged((changes, areaName) => {
      for (const fn of changeListeners) {
        fn(changes, areaName);
      }
    });
  }

  const storageStub = {
    local: {
      get: (keys?: any) => eStorage ? eStorage.get(keys) : Promise.resolve({}),
      set: (items: any) => eStorage ? eStorage.set(items) : Promise.resolve(),
      remove: (keys: any) => eStorage ? eStorage.remove(keys) : Promise.resolve(),
    },
    session: {
      get: (_keys?: any) => Promise.resolve({}),
      set: (_items: any) => Promise.resolve(),
    },
    onChanged: {
      addListener: (fn: Listener) => { changeListeners.push(fn); },
      removeListener: (fn: Listener) => {
        const idx = changeListeners.indexOf(fn);
        if (idx >= 0) changeListeners.splice(idx, 1);
      },
      hasListener: (fn: Listener) => changeListeners.includes(fn),
    },
  };

  // Runtime stubs
  const messageListeners: Listener[] = [];

  if (eRuntime) {
    eRuntime.onMessage((message) => {
      for (const fn of messageListeners) {
        fn(message, {}, () => {});
      }
    });
  }

  const runtimeStub = {
    sendMessage: (message: any, callback?: (response: any) => void) => {
      if (eRuntime) {
        const promise = eRuntime.sendMessage(message);
        if (callback) {
          promise.then(callback).catch(() => callback(undefined));
          return;
        }
        return promise;
      }
      if (callback) { callback(null); return; }
      return Promise.resolve(null);
    },
    onMessage: {
      addListener: (fn: Listener) => { messageListeners.push(fn); },
      removeListener: (fn: Listener) => {
        const idx = messageListeners.indexOf(fn);
        if (idx >= 0) messageListeners.splice(idx, 1);
      },
      hasListener: (fn: Listener) => messageListeners.includes(fn),
    },
    getURL: (path: string) => path,
    lastError: null as any,
    id: 'electron-stub',
  };

  (globalThis as any).chrome = {
    ...((globalThis as any).chrome ?? {}),
    storage: storageStub,
    runtime: runtimeStub,
    tabs: tabsStub,
  };
}
