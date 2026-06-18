import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import {
  createServiceClient,
  getAuthenticatedUser,
  resolveOwnedAvatar,
} from "../_shared/supabase.ts";
import { resolveZernioProfileForAvatar, zernioRequest } from "../_shared/zernio.ts";

type ZernioAccount = {
  _id?: string;
  id?: string;
  accountId?: string;
  platform?: string;
  profileId?: string | { _id?: string; id?: string };
  username?: string;
  displayName?: string;
  display_name?: string;
  profileUrl?: string;
  profile_url?: string;
  isActive?: boolean;
};

/**
 * Zernio's platform string varies (e.g. "youtube" vs "you-tube"). Normalize to
 * the two platforms this app supports. Returns null for anything unsupported.
 */
function normalizePlatform(raw: string | undefined): "instagram" | "youtube" | null {
  const p = (raw ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (p.includes("instagram") || p === "ig") return "instagram";
  if (p.includes("youtube") || p === "yt") return "youtube";
  return null;
}

function extractAccountProfileId(
  profileId: ZernioAccount["profileId"],
): string | undefined {
  if (typeof profileId === "string") return profileId;
  return profileId?._id ?? profileId?.id;
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const user = await getAuthenticatedUser(request);
    const service = createServiceClient();
    const body = await request.json().catch(() => ({}));
    const avatar = await resolveOwnedAvatar(service, user.id, body.avatarId);
    const profileId = await resolveZernioProfileForAvatar(service, avatar);

    // Fetch every account under this avatar's profile, regardless of platform.
    // Filtering by platform in the query is unreliable (Zernio's platform
    // string varies), so we pull all and normalize each one ourselves.
    const params = new URLSearchParams({ profileId });
    const response = await zernioRequest<{
      accounts?: ZernioAccount[];
      data?: ZernioAccount[];
    }>(`/accounts?${params.toString()}`);

    const accounts = response.accounts ?? response.data ?? [];

    // Definitive, compact diagnostic: how many accounts and which platforms.
    console.log(
      "Zernio /accounts:",
      "count=", accounts.length,
      "platforms=", JSON.stringify(accounts.map((a) => ({ id: a._id ?? a.id, platform: a.platform }))),
    );

    const rows = accounts
      .map((account) => {
        const accountProfileId = extractAccountProfileId(account.profileId);
        const platform = normalizePlatform(account.platform);
        return { account, accountProfileId, platform };
      })
      .filter(({ accountProfileId, platform }) => {
        // Keep only supported platforms that belong to this profile.
        if (!platform) return false;
        return !accountProfileId || accountProfileId === profileId;
      })
      .map(({ account, platform }) => {
        const label = platform === "youtube" ? "YouTube" : "Instagram";
        return {
          user_id: user.id,
          avatar_id: avatar.id,
          zernio_profile_id: profileId,
          zernio_account_id: account._id ?? account.id ?? account.accountId,
          platform,
          username: account.username ?? null,
          display_name:
            account.displayName ?? account.display_name ?? account.username ?? label,
          profile_url: account.profileUrl ?? account.profile_url ?? null,
          active: account.isActive ?? true,
        };
      })
      .filter((row) => row.zernio_account_id);

    if (rows.length > 0) {
      const { error } = await service
        .from("social_accounts")
        .upsert(rows, { onConflict: "user_id,avatar_id,zernio_account_id" });
      if (error) throw error;
    }

    const platformsFound = [...new Set(rows.map((r) => r.platform))];

    return jsonResponse({
      count: rows.length,
      platforms: platformsFound,
      // How many raw accounts Zernio returned (helps diagnose empty syncs)
      returned: accounts.length,
      // The raw platform strings Zernio returned, so the UI can show what's
      // actually connected on Zernio's side (e.g. only "instagram").
      returnedPlatforms: accounts.map((a) => a.platform).filter(Boolean),
    });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});
