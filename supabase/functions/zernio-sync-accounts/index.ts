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

const ALL_PLATFORMS = ["instagram", "youtube"] as const;
type SupportedPlatform = typeof ALL_PLATFORMS[number];

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const user = await getAuthenticatedUser(request);
    const service = createServiceClient();
    const body = await request.json().catch(() => ({}));
    const avatar = await resolveOwnedAvatar(service, user.id, body.avatarId);
    const profileId = await resolveZernioProfileForAvatar(service, avatar);

    // Sync the requested platform(s). Default: both.
    const requestedPlatform = body.platform as string | undefined;
    const platforms: SupportedPlatform[] = requestedPlatform
      ? ALL_PLATFORMS.filter((p) => p === requestedPlatform)
      : [...ALL_PLATFORMS];

    if (platforms.length === 0) {
      throw new Error(`Unsupported platform: ${requestedPlatform}`);
    }

    let totalCount = 0;

    for (const platform of platforms) {
      const params = new URLSearchParams({ platform, profileId });
      const response = await zernioRequest<{
        accounts?: ZernioAccount[];
        data?: ZernioAccount[];
      }>(`/accounts?${params.toString()}`);

      const accounts = response.accounts ?? response.data ?? [];
      const platformLabel = platform === "youtube" ? "YouTube" : "Instagram";

      const rows = accounts
        .filter((account) => {
          const accountProfileId =
            typeof account.profileId === "string"
              ? account.profileId
              : account.profileId?._id ?? account.profileId?.id;
          const accountPlatform = account.platform ?? platform;
          return (
            accountPlatform === platform &&
            (!accountProfileId || accountProfileId === profileId)
          );
        })
        .map((account) => ({
          user_id: user.id,
          avatar_id: avatar.id,
          zernio_profile_id: profileId,
          zernio_account_id: account._id ?? account.id ?? account.accountId,
          platform,
          username: account.username ?? null,
          display_name:
            account.displayName ?? account.display_name ?? account.username ?? platformLabel,
          profile_url: account.profileUrl ?? account.profile_url ?? null,
          active: account.isActive ?? true,
        }))
        .filter((account) => account.zernio_account_id);

      if (rows.length > 0) {
        const { error } = await service
          .from("social_accounts")
          .upsert(rows, { onConflict: "user_id,avatar_id,zernio_account_id" });
        if (error) throw error;
        totalCount += rows.length;
      }
    }

    return jsonResponse({ count: totalCount });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});
