import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { createServiceClient, getAuthenticatedUser } from "../_shared/supabase.ts";
import { zernioRequest } from "../_shared/zernio.ts";

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

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const user = await getAuthenticatedUser(request);
    const service = createServiceClient();
    const profileId = Deno.env.get("ZERNIO_PROFILE_ID");
    if (!profileId) throw new Error("Missing ZERNIO_PROFILE_ID");

    const params = new URLSearchParams({
      platform: "instagram",
      profileId,
    });
    const response = await zernioRequest<{ accounts?: ZernioAccount[]; data?: ZernioAccount[] }>(
      `/accounts?${params.toString()}`,
    );
    const accounts = response.accounts ?? response.data ?? [];

    const rows = accounts
      .filter((account) => {
        const accountProfileId =
          typeof account.profileId === "string"
            ? account.profileId
            : account.profileId?._id ?? account.profileId?.id;
        return (
          (account.platform ?? "instagram") === "instagram" &&
          (!accountProfileId || accountProfileId === profileId)
        );
      })
      .map((account) => ({
        user_id: user.id,
        zernio_profile_id: profileId,
        zernio_account_id: account._id ?? account.id ?? account.accountId,
        platform: "instagram",
        username: account.username ?? null,
        display_name:
          account.displayName ?? account.display_name ?? account.username ?? "Instagram",
        profile_url: account.profileUrl ?? account.profile_url ?? null,
        active: account.isActive ?? true,
      }))
      .filter((account) => account.zernio_account_id);

    if (rows.length > 0) {
      const { error } = await service
        .from("social_accounts")
        .upsert(rows, { onConflict: "user_id,zernio_account_id" });
      if (error) throw error;
    }

    return jsonResponse({ count: rows.length });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});
