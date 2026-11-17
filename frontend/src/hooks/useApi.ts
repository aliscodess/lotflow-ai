import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../services/api';
import { useRealtime } from '../context/RealtimeContext';

/**
 * Loads data with loading / error state. `refetch` reloads silently (no skeleton),
 * which keeps live-updating screens from flickering.
 */
export function useApi<T>(fetcher: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  const mounted = useRef(true);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const result = await fetchRef.current();
      if (mounted.current) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (mounted.current && !silent) setError(errorMessage(err));
    } finally {
      if (mounted.current && !silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    load();
    return () => {
      mounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const refetch = useCallback(() => load(true), [load]);
  const retry = useCallback(() => load(false), [load]);
  return { data, setData, loading, error, refetch, retry };
}

/**
 * Re-runs `refetch` when any of the given socket events arrive (debounced),
 * and falls back to polling every 20 s while the socket is disconnected.
 */
export function useLiveRefresh(events: string[], refetch: () => void, pollMs = 20000) {
  const { subscribe, connected } = useRealtime();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = events.join('|');

  useEffect(() => {
    const unsubscribe = subscribe(events, () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(refetch, 250);
    });
    return () => {
      unsubscribe();
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refetch, subscribe]);

  useEffect(() => {
    if (connected) return;
    const id = setInterval(refetch, pollMs);
    return () => clearInterval(id);
  }, [connected, refetch, pollMs]);
}
