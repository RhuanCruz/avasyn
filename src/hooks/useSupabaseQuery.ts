import { useCallback, useEffect, useRef, useState } from "react";

type QueryState<T> = {
  data: T;
  error: string | null;
  loading: boolean;
};

export function useSupabaseQuery<T>(
  load: () => Promise<T>,
  initialData: T,
): QueryState<T> & { refresh: () => Promise<void> } {
  const initialDataRef = useRef(initialData);
  const [state, setState] = useState<QueryState<T>>({
    data: initialData,
    error: null,
    loading: true,
  });

  const refresh = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const data = await load();
      setState({ data, error: null, loading: false });
    } catch (error) {
      setState({
        data: initialDataRef.current,
        error: error instanceof Error ? error.message : "Erro desconhecido",
        loading: false,
      });
    }
  }, [load]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { ...state, refresh };
}
