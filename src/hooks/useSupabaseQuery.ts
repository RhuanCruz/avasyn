import { useCallback, useEffect, useRef, useState } from "react";

type QueryState<T> = {
  data: T;
  error: string | null;
  /** True only until the first result for the current `load` arrives. */
  loading: boolean;
  /** True while a background re-fetch of already-loaded data is in flight. */
  refreshing: boolean;
};

export function useSupabaseQuery<T>(
  load: () => Promise<T>,
  initialData: T,
): QueryState<T> & { refresh: () => Promise<void> } {
  const initialDataRef = useRef(initialData);
  // Which `load` identity has produced a result. A new identity (e.g. the
  // avatar changed) counts as a fresh query and blocks with `loading` again.
  const loadedForRef = useRef<(() => Promise<T>) | null>(null);
  // Guards against an older in-flight request resolving after a newer one and
  // overwriting fresher data — realtime subscriptions can stack refreshes.
  const requestIdRef = useRef(0);
  const [state, setState] = useState<QueryState<T>>({
    data: initialData,
    error: null,
    loading: true,
    refreshing: false,
  });

  const refresh = useCallback(async () => {
    // Refreshing must NOT flip `loading` back on: consumers early-return a
    // skeleton while loading, which unmounts open modals/wizards and wipes
    // their local state (see AutomationWizard losing its draft on save).
    const isFirstLoad = loadedForRef.current !== load;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setState((current) => ({
      ...current,
      error: null,
      loading: isFirstLoad,
      refreshing: !isFirstLoad,
    }));

    try {
      const data = await load();
      if (requestIdRef.current !== requestId) return;
      loadedForRef.current = load;
      setState({ data, error: null, loading: false, refreshing: false });
    } catch (error) {
      if (requestIdRef.current !== requestId) return;
      setState((current) => ({
        // A failed background refresh keeps what is already on screen; only a
        // failed first load falls back to the empty initial value.
        data: isFirstLoad ? initialDataRef.current : current.data,
        error: error instanceof Error ? error.message : "Erro desconhecido",
        loading: false,
        refreshing: false,
      }));
    }
  }, [load]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { ...state, refresh };
}
