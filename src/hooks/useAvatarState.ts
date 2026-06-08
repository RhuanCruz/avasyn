import { useCallback, useEffect, useState } from "react";

import { useSupabaseQuery } from "@/hooks/useSupabaseQuery";
import { resolveAvatarSelection } from "@/lib/avatar-utils";
import { supabase } from "@/lib/supabase";
import type { Avatar } from "@/lib/types";

const STORAGE_KEY = "avasyn:selected-avatar-id";

export function useAvatarState(preferredAvatarId?: string | null) {
  const loadAvatars = useCallback(async () => {
    const { data, error } = await supabase
      .from("avatars")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) throw error;
    return (data ?? []) as Avatar[];
  }, []);

  const avatars = useSupabaseQuery(loadAvatars, [] as Avatar[]);
  const [storedAvatarId, setStoredAvatarId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(STORAGE_KEY);
  });

  const selectedAvatarId = resolveAvatarSelection(
    avatars.data,
    preferredAvatarId ?? storedAvatarId,
  );
  const selectedAvatar =
    avatars.data.find((avatar) => avatar.id === selectedAvatarId) ?? null;

  const setSelectedAvatarId = useCallback((nextAvatarId: string | null) => {
    setStoredAvatarId(nextAvatarId);
    if (typeof window !== "undefined") {
      if (nextAvatarId) {
        window.localStorage.setItem(STORAGE_KEY, nextAvatarId);
      } else {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, []);

  useEffect(() => {
    if (preferredAvatarId && preferredAvatarId !== storedAvatarId) {
      setSelectedAvatarId(preferredAvatarId);
    }
  }, [preferredAvatarId, setSelectedAvatarId, storedAvatarId]);

  useEffect(() => {
    if (selectedAvatarId && selectedAvatarId !== storedAvatarId) {
      setSelectedAvatarId(selectedAvatarId);
    }
  }, [selectedAvatarId, setSelectedAvatarId, storedAvatarId]);

  return {
    avatars: avatars.data,
    error: avatars.error,
    avatarsError: avatars.error,
    loading: avatars.loading,
    avatarsLoading: avatars.loading,
    refresh: avatars.refresh,
    refreshAvatars: avatars.refresh,
    selectedAvatar,
    selectedAvatarId,
    setSelectedAvatarId,
  };
}
