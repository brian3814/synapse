import type { ExtractionProgressEvent } from '../shared/reading-list-types';

type Listener = (event: ExtractionProgressEvent) => void;

class ExtractionProgressService {
  private listeners = new Map<string, Set<Listener>>();
  private globalListeners = new Set<Listener>();
  private buffer = new Map<string, ExtractionProgressEvent[]>();

  on(resourceId: string, listener: Listener): () => void {
    if (!this.listeners.has(resourceId)) {
      this.listeners.set(resourceId, new Set());
    }
    this.listeners.get(resourceId)!.add(listener);

    const buffered = this.buffer.get(resourceId);
    if (buffered) {
      for (const event of buffered) listener(event);
    }

    return () => {
      this.listeners.get(resourceId)?.delete(listener);
    };
  }

  onAll(listener: Listener): () => void {
    this.globalListeners.add(listener);
    return () => {
      this.globalListeners.delete(listener);
    };
  }

  emit(event: ExtractionProgressEvent): void {
    if (!this.buffer.has(event.resourceId)) {
      this.buffer.set(event.resourceId, []);
    }
    this.buffer.get(event.resourceId)!.push(event);

    this.listeners.get(event.resourceId)?.forEach(l => l(event));
    this.globalListeners.forEach(l => l(event));
  }

  clear(resourceId: string): void {
    this.listeners.delete(resourceId);
    this.buffer.delete(resourceId);
  }
}

export const extractionProgress = new ExtractionProgressService();
