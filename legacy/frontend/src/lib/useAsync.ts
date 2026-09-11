import { useCallback, useEffect, useRef, useState } from 'react';

/** Hook mínimo para cargar datos con estado de carga/error y refetch. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const run = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await fnRef.current()); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void run(); }, deps);
  return { data, error, loading, reload: run, setData };
}
