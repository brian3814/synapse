import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExtractionProgressEvent } from '../../src/shared/reading-list-types';

// Fresh instance per test — can't use the singleton because it accumulates state
function createProgressService() {
  const listeners = new Map<string, Set<(event: ExtractionProgressEvent) => void>>();
  const globalListeners = new Set<(event: ExtractionProgressEvent) => void>();
  const buffer = new Map<string, ExtractionProgressEvent[]>();

  return {
    on(resourceId: string, listener: (event: ExtractionProgressEvent) => void): () => void {
      if (!listeners.has(resourceId)) listeners.set(resourceId, new Set());
      listeners.get(resourceId)!.add(listener);
      const buffered = buffer.get(resourceId);
      if (buffered) {
        for (const event of buffered) listener(event);
      }
      return () => { listeners.get(resourceId)?.delete(listener); };
    },
    onAll(listener: (event: ExtractionProgressEvent) => void): () => void {
      globalListeners.add(listener);
      return () => { globalListeners.delete(listener); };
    },
    emit(event: ExtractionProgressEvent): void {
      if (!buffer.has(event.resourceId)) buffer.set(event.resourceId, []);
      buffer.get(event.resourceId)!.push(event);
      listeners.get(event.resourceId)?.forEach(l => l(event));
      globalListeners.forEach(l => l(event));
    },
    clear(resourceId: string): void {
      listeners.delete(resourceId);
      buffer.delete(resourceId);
    },
  };
}

function makeEvent(stage: string, resourceId = 'res-1'): ExtractionProgressEvent {
  return { type: 'stage-start', resourceId, stage: stage as any };
}

function makeCompleteEvent(stage: string, resourceId = 'res-1', statusText?: string): ExtractionProgressEvent {
  return { type: 'stage-complete', resourceId, stage: stage as any, meta: { ms: 100 }, statusText };
}

describe('ExtractionProgressService', () => {
  let service: ReturnType<typeof createProgressService>;

  beforeEach(() => {
    service = createProgressService();
  });

  describe('on() — per-resource subscription', () => {
    it('delivers events only to matching resource listeners', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      service.on('res-1', listener1);
      service.on('res-2', listener2);

      service.emit(makeEvent('fetch', 'res-1'));

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).not.toHaveBeenCalled();
    });

    it('supports multiple listeners for the same resource', () => {
      const a = vi.fn();
      const b = vi.fn();
      service.on('res-1', a);
      service.on('res-1', b);

      service.emit(makeEvent('fetch'));

      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(1);
    });

    it('returns an unsubscribe function that stops delivery', () => {
      const listener = vi.fn();
      const unsub = service.on('res-1', listener);

      service.emit(makeEvent('fetch'));
      expect(listener).toHaveBeenCalledTimes(1);

      unsub();
      service.emit(makeEvent('parse'));
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('onAll() — global subscription', () => {
    it('receives events for all resources', () => {
      const global = vi.fn();
      service.onAll(global);

      service.emit(makeEvent('fetch', 'res-1'));
      service.emit(makeEvent('parse', 'res-2'));

      expect(global).toHaveBeenCalledTimes(2);
      expect(global).toHaveBeenCalledWith(expect.objectContaining({ resourceId: 'res-1' }));
      expect(global).toHaveBeenCalledWith(expect.objectContaining({ resourceId: 'res-2' }));
    });

    it('returns an unsubscribe function', () => {
      const global = vi.fn();
      const unsub = service.onAll(global);

      service.emit(makeEvent('fetch'));
      unsub();
      service.emit(makeEvent('parse'));

      expect(global).toHaveBeenCalledTimes(1);
    });
  });

  describe('event buffering', () => {
    it('replays buffered events to late subscribers', () => {
      service.emit(makeEvent('fetch'));
      service.emit(makeCompleteEvent('fetch'));
      service.emit(makeEvent('parse'));

      const lateListener = vi.fn();
      service.on('res-1', lateListener);

      expect(lateListener).toHaveBeenCalledTimes(3);
      expect(lateListener).toHaveBeenNthCalledWith(1, expect.objectContaining({ type: 'stage-start', stage: 'fetch' }));
      expect(lateListener).toHaveBeenNthCalledWith(2, expect.objectContaining({ type: 'stage-complete', stage: 'fetch' }));
      expect(lateListener).toHaveBeenNthCalledWith(3, expect.objectContaining({ type: 'stage-start', stage: 'parse' }));
    });

    it('does not replay events from other resources', () => {
      service.emit(makeEvent('fetch', 'res-1'));
      service.emit(makeEvent('fetch', 'res-2'));

      const listener = vi.fn();
      service.on('res-1', listener);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ resourceId: 'res-1' }));
    });

    it('delivers both buffered and new events after subscribe', () => {
      service.emit(makeEvent('fetch'));

      const listener = vi.fn();
      service.on('res-1', listener);

      expect(listener).toHaveBeenCalledTimes(1);

      service.emit(makeEvent('parse'));
      expect(listener).toHaveBeenCalledTimes(2);
    });

    it('no buffer replay if no events were emitted', () => {
      const listener = vi.fn();
      service.on('res-1', listener);
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('clear()', () => {
    it('removes listeners for a resource', () => {
      const listener = vi.fn();
      service.on('res-1', listener);

      service.clear('res-1');
      service.emit(makeEvent('fetch'));

      expect(listener).toHaveBeenCalledTimes(0);
    });

    it('clears the event buffer for a resource', () => {
      service.emit(makeEvent('fetch'));
      service.emit(makeCompleteEvent('fetch'));

      service.clear('res-1');

      const lateListener = vi.fn();
      service.on('res-1', lateListener);
      expect(lateListener).not.toHaveBeenCalled();
    });

    it('does not affect other resources', () => {
      service.emit(makeEvent('fetch', 'res-1'));
      service.emit(makeEvent('fetch', 'res-2'));

      service.clear('res-1');

      const listener = vi.fn();
      service.on('res-2', listener);
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('statusText propagation', () => {
    it('carries statusText on stage-start events', () => {
      const listener = vi.fn();
      service.on('res-1', listener);

      const event: ExtractionProgressEvent = {
        type: 'stage-start', resourceId: 'res-1', stage: 'fetch',
        statusText: 'Fetching example.com...',
      };
      service.emit(event);

      expect(listener).toHaveBeenCalledWith(expect.objectContaining({
        statusText: 'Fetching example.com...',
      }));
    });

    it('carries statusText on stage-complete events', () => {
      const listener = vi.fn();
      service.on('res-1', listener);

      const event: ExtractionProgressEvent = {
        type: 'stage-complete', resourceId: 'res-1', stage: 'fetch',
        meta: { bytes: 48000, ms: 210 },
        statusText: 'Retrieved 46.9KB from example.com',
      };
      service.emit(event);

      expect(listener).toHaveBeenCalledWith(expect.objectContaining({
        statusText: 'Retrieved 46.9KB from example.com',
        meta: { bytes: 48000, ms: 210 },
      }));
    });

    it('preserves statusText in buffered replay', () => {
      service.emit({
        type: 'stage-start', resourceId: 'res-1', stage: 'fetch',
        statusText: 'Fetching...',
      });
      service.emit({
        type: 'stage-complete', resourceId: 'res-1', stage: 'fetch',
        statusText: 'Done fetching',
      });

      const late = vi.fn();
      service.on('res-1', late);

      expect(late).toHaveBeenNthCalledWith(1, expect.objectContaining({ statusText: 'Fetching...' }));
      expect(late).toHaveBeenNthCalledWith(2, expect.objectContaining({ statusText: 'Done fetching' }));
    });
  });

  describe('event types', () => {
    it('handles llm-chunk events', () => {
      const listener = vi.fn();
      service.on('res-1', listener);

      service.emit({ type: 'llm-chunk', resourceId: 'res-1', text: '{"summary":' });
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'llm-chunk', text: '{"summary":' }));
    });

    it('handles chunk-progress events', () => {
      const listener = vi.fn();
      service.on('res-1', listener);

      service.emit({ type: 'chunk-progress', resourceId: 'res-1', current: 3, total: 10, label: 'Section 3' });
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ current: 3, total: 10, label: 'Section 3' }));
    });

    it('handles strategy-selected events', () => {
      const listener = vi.fn();
      service.on('res-1', listener);

      service.emit({ type: 'strategy-selected', resourceId: 'res-1', strategy: 'chunked', reason: '50KB text' });
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ strategy: 'chunked', reason: '50KB text' }));
    });

    it('handles error events', () => {
      const listener = vi.fn();
      service.on('res-1', listener);

      service.emit({ type: 'error', resourceId: 'res-1', stage: 'fetch', message: 'Network error' });
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', stage: 'fetch', message: 'Network error' }));
    });
  });
});
