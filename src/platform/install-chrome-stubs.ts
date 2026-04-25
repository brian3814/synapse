type Listener = (...args: any[]) => any;

class EventStub {
  private listeners: Listener[] = [];
  addListener(fn: Listener) { this.listeners.push(fn); }
  removeListener(fn: Listener) {
    this.listeners = this.listeners.filter((l) => l !== fn);
  }
  hasListener(fn: Listener) { return this.listeners.includes(fn); }
}

const storageStub = {
  local: {
    get: (_keys?: any) => Promise.resolve({}),
    set: (_items: any) => Promise.resolve(),
    remove: (_keys: any) => Promise.resolve(),
  },
  session: {
    get: (_keys?: any) => Promise.resolve({}),
    set: (_items: any) => Promise.resolve(),
  },
  onChanged: new EventStub(),
};

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
    return; // Already in a Chrome extension context
  }

  const stub = {
    storage: storageStub,
    runtime: runtimeStub,
    tabs: tabsStub,
  };

  (globalThis as any).chrome = {
    ...((globalThis as any).chrome ?? {}),
    ...stub,
  };
}
