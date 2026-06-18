import { useCallback } from "react";

import { useSupabaseQuery } from "@/hooks/useSupabaseQuery";
import { supabase } from "@/lib/supabase";
import type { ReelJob, SocialAccount } from "@/lib/types";

export type PostCalendarData = {
  accounts: SocialAccount[];
  posts: ReelJob[];
  hasConnectedAccount: boolean;
};

const INITIAL: PostCalendarData = {
  accounts: [],
  posts: [],
  hasConnectedAccount: false,
};

export function usePostCalendar(avatarId: string | null) {
  const load = useCallback(async (): Promise<PostCalendarData> => {
    if (!avatarId) return INITIAL;

    const [accountsResult, postsResult] = await Promise.all([
      supabase
        .from("social_accounts")
        .select("*")
        .eq("avatar_id", avatarId)
        .order("created_at", { ascending: false }),
      supabase
        .from("reel_jobs")
        .select("*, reel_job_targets(*)")
        .eq("avatar_id", avatarId)
        .or("scheduled_post_at.not.is.null,posted_at.not.is.null")
        .order("scheduled_post_at", { ascending: true, nullsFirst: false }),
    ]);

    if (accountsResult.error) throw accountsResult.error;
    if (postsResult.error) throw postsResult.error;

    const accounts = (accountsResult.data ?? []) as SocialAccount[];
    const posts = (postsResult.data ?? []) as ReelJob[];

    return {
      accounts,
      posts,
      hasConnectedAccount: accounts.some((a) => a.active),
    };
  }, [avatarId]);

  return useSupabaseQuery(load, INITIAL);
}
