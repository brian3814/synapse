import { ExtractionProgressEvent } from '../shared/reading-list-types';

type Listener = (event: ExtractionProgressEvent) => void;

class ExtractionProgressService {
  private listeners = new Map<string, Set<Listener>>();
  private globalListeners = new Set<Listener>();

  on(resourceId: string, listener: Listener): () => void {
    if (!this.listeners.has(resourceId)) {
      this.listeners.set(resourceId, new Set());
    }
    this.listeners.get(resourceId)!.add(listener);
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
    this.listeners.get(event.resourceId)?.forEach(l => l(event));
    this.globalListeners.forEach(l => l(event));
  }

  clear(resourceId: string): void {
    this.listeners.delete(resourceId);
  }
}

export const extractionProgress = new ExtractionProgressService();
