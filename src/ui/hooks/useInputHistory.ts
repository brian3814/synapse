import { useRef, useCallback } from 'react';

export function useInputHistory(maxSize = 50) {
  const historyRef = useRef<string[]>([]);
  const indexRef = useRef<number | null>(null);
  const savedInputRef = useRef('');

  const push = useCallback((text: string) => {
    const history = historyRef.current;
    // Dedup consecutive
    if (history.length > 0 && history[history.length - 1] === text) return;
    history.push(text);
    if (history.length > maxSize) history.shift();
  }, [maxSize]);

  const navigateUp = useCallback((currentInput: string): string | null => {
    const history = historyRef.current;
    if (history.length === 0) return null;

    if (indexRef.current === null) {
      // Starting navigation — save current input
      savedInputRef.current = currentInput;
      indexRef.current = history.length - 1;
    } else if (indexRef.current > 0) {
      indexRef.current--;
    } else {
      return null; // Already at oldest
    }

    return history[indexRef.current];
  }, []);

  const navigateDown = useCallback((): string | null => {
    if (indexRef.current === null) return null;

    const history = historyRef.current;
    if (indexRef.current < history.length - 1) {
      indexRef.current++;
      return history[indexRef.current];
    } else {
      // Back to saved input
      const saved = savedInputRef.current;
      indexRef.current = null;
      return saved;
    }
  }, []);

  const reset = useCallback(() => {
    indexRef.current = null;
  }, []);

  return { push, navigateUp, navigateDown, reset };
}
