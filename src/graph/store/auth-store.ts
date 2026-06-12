import { create } from 'zustand';
import { storage, browser } from '@platform';

interface AuthStore {
  authenticated: boolean;
  loading: boolean;
  error: string | null;

  checkAuth: () => Promise<void>;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  startAuthListener: () => () => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  authenticated: false,
  loading: true,
  error: null,

  checkAuth: async () => {
    set({ loading: true, error: null });
    try {
      const result = await (browser as any).sendOAuth('OAUTH_CHECK');
      set({ authenticated: result?.authenticated ?? false, loading: false });
    } catch (e: any) {
      set({ authenticated: false, loading: false, error: e.message });
    }
  },

  signIn: async () => {
    set({ loading: true, error: null });
    try {
      const result = await (browser as any).sendOAuth('OAUTH_START');
      if (result?.error) {
        set({ loading: false, error: result.error });
      }
      // The OAUTH_STATUS broadcast will update authenticated state via the listener
    } catch (e: any) {
      set({ loading: false, error: e.message });
    }
  },

  signOut: async () => {
    set({ loading: true, error: null });
    try {
      await (browser as any).sendOAuth('OAUTH_REVOKE');
      set({ authenticated: false, loading: false });
    } catch (e: any) {
      set({ loading: false, error: e.message });
    }
  },

  startAuthListener: () => {
    // Listen for OAUTH_STATUS broadcasts from SW
    const messageListener = (message: any) => {
      if (message.type === 'OAUTH_STATUS') {
        set({
          authenticated: message.payload?.authenticated ?? false,
          loading: false,
          error: message.payload?.error ?? null,
        });
      }
    };
    const cleanupMessages = (browser as any).onRuntimeMessage(messageListener);

    // Also listen for storage changes (token added/removed)
    const storageListener = (changes: Record<string, { newValue?: unknown }>, areaName: string) => {
      if (areaName === 'local' && changes.anthropicOAuth) {
        const hasTokens = !!changes.anthropicOAuth.newValue;
        set({ authenticated: hasTokens });
      }
    };
    const cleanupStorage = storage.onChange(storageListener);

    return () => {
      cleanupMessages();
      cleanupStorage();
    };
  },
}));
