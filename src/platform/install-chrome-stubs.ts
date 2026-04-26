type Listener = (...args: any[]) => any;

class EventStub {
  private listeners: Listener[] = [];
  addListener(fn: Listener) { this.listeners.push(fn); }
  removeListener(fn: Listener) {
    this.listeners = this.listeners.filter((l) => l !== fn);
  }
  hasListener(fn: Listener) { return this.listeners.includes(fn); }
}

const runtimeStub = {
  sendMessage: (_message: any) => Promise.resolve(null),
  onMessage: new EventStub(),
  onInstalled: new EventStub(),
  getURL: (path: string) => path,
  lastError: null as chrome.runtime.LastError | null,
  id: 'electron-stub',
};

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

  (globalThis as any).chrome = {
    ...((globalThis as any).chrome ?? {}),
    storage: storageStub,
    runtime: runtimeStub,
    tabs: tabsStub,
  };
}
