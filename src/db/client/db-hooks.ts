import { useState, useEffect, useCallback, useRef } from 'react';
import { nodes, edges, initDbClient } from './db-client';
import type { DbNode, DbEdge } from '../../shared/types';

// Hook to initialize the database
export function useDbInit(): { ready: boolean; error: string | null } {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    initDbClient()
      .then(() => setReady(true))
      .catch((e) => {
        console.error('[useDbInit] Failed:', e);
        setError(e.message);
      });
  }, []);

  return { ready, error };
}

// Generic query hook with loading/error states
export function useQuery<T>(
  queryFn: () => Promise<T>,
  deps: unknown[] = []
): { data: T | null; loading: boolean; error: string | null; refetch: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await queryFn();
      if (mountedRef.current) {
        setData(result);
      }
    } catch (e: any) {
      if (mountedRef.current) {
        setError(e.message);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, deps);

  useEffect(() => {
    mountedRef.current = true;
    fetch();
    return () => {
      mountedRef.current = false;
    };
  }, [fetch]);

  return { data, loading, error, refetch: fetch };
}

// Mutation hook with optimistic updates
export function useMutation<TInput, TResult>(
  mutationFn: (input: TInput) => Promise<TResult>,
  options?: {
    onSuccess?: (result: TResult) => void;
    onError?: (error: Error) => void;
  }
): {
  mutate: (input: TInput) => Promise<TResult | undefined>;
  loading: boolean;
  error: string | null;
} {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutate = useCallback(
    async (input: TInput): Promise<TResult | undefined> => {
      setLoading(true);
      setError(null);
      try {
        const result = await mutationFn(input);
        options?.onSuccess?.(result);
        return result;
      } catch (e: any) {
        setError(e.message);
        options?.onError?.(e);
        return undefined;
      } finally {
        setLoading(false);
      }
    },
    [mutationFn]
  );

  return { mutate, loading, error };
}

// Convenience hooks for common operations
export function useNodes() {
  return useQuery<DbNode[]>(() => nodes.getAll(), []);
}

export function useNode(id: string | null) {
  return useQuery<DbNode | null>(
    () => (id ? nodes.getById(id) : Promise.resolve(null)),
    [id]
  );
}

export function useEdges() {
  return useQuery<DbEdge[]>(() => edges.getAll(), []);
}

export function useEdgesForNode(nodeId: string | null) {
  return useQuery<DbEdge[]>(
    () => (nodeId ? edges.getForNode(nodeId) : Promise.resolve([])),
    [nodeId]
  );
}

export function useNodeSearch(query: string, limit = 50) {
  return useQuery<DbNode[]>(
    () => (query.length > 0 ? nodes.search(query, limit) : Promise.resolve([])),
    [query, limit]
  );
}
