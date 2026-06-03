import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { getAuthenticatedUser } from "../_shared/supabase.ts";
import { zernioRequest } from "../_shared/zernio.ts";

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    await getAuthenticatedUser(request);
    const { redirectUrl } = await request.json().catch(() => ({}));
    const profileId = Deno.env.get("ZERNIO_PROFILE_ID");
    if (!profileId) throw new Error("Missing ZERNIO_PROFILE_ID");

    const params = new URLSearchParams({
      profileId,
      ...(redirectUrl ? { redirect_url: String(redirectUrl) } : {}),
    });
    const response = await zernioRequest<{
      authUrl?: string;
      auth_url?: string;
      url?: string;
      connectUrl?: string;
    }>(
      `/connect/instagram?${params.toString()}`,
    );
    const url = response.authUrl ?? response.auth_url ?? response.url ?? response.connectUrl;
    if (!url) throw new Error("Zernio did not return a connect URL");

    return jsonResponse({ url });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});
