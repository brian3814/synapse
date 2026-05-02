type Listener = (...args: any[]) => any;

const tabsStub = {
  query: (_queryInfo: any) => Promise.resolve([]),
  sendMessage: (_tabId: number, _message: any) => Promise.resolve(null),
  create: (_props: any) => Promise.resolve({ id: 0 }),
};

declare const window: Window & {
  electronIPC?: {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    on(channel: string, cb: (...args: unknown[]) => void): () => void;
  };
};

export function installChromeStubs(): void {
  if (typeof globalThis.chrome?.runtime?.id === 'string') {
    return;
  }

  const eIPC = (window as any).electronIPC as {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    on(channel: string, cb: (...args: unknown[]) => void): () => void;
  } | undefined;

  // Storage stubs
  const changeListeners: Listener[] = [];

  if (eIPC) {
    eIPC.on('storage:changed', (changes: unknown, areaName: unknown) => {
      for (const fn of changeListeners) {
        fn(changes, areaName);
      }
    });
  }

  const storageStub = {
    local: {
      get: (keys?: any) => eIPC ? eIPC.invoke('storage:get', keys) : Promise.resolve({}),
      set: (items: any) => eIPC ? eIPC.invoke('storage:set', items) : Promise.resolve(),
      remove: (keys: any) => eIPC ? eIPC.invoke('storage:remove', keys) : Promise.resolve(),
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

  if (eIPC) {
    eIPC.on('runtime:broadcast', (message: unknown) => {
      for (const fn of messageListeners) {
        fn(message, {}, () => {});
      }
    });
  }

  const runtimeStub = {
    sendMessage: (message: any, callback?: (response: any) => void) => {
      if (eIPC) {
        const promise = eIPC.invoke('runtime:sendMessage', message);
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

  // Wire companion capture events to runtime message listeners
  if (eIPC) {
    eIPC.on('companion:capture', (data: unknown) => {
      for (const fn of messageListeners) {
        fn({ type: 'COMPANION_PAGE_CAPTURED', payload: data }, {}, () => {});
      }
    });
  }
}
