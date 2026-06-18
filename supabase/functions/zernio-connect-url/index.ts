import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import {
  createServiceClient,
  getAuthenticatedUser,
  resolveOwnedAvatar,
} from "../_shared/supabase.ts";
import { resolveZernioProfileForAvatar, zernioRequest } from "../_shared/zernio.ts";

const ALLOWED_PLATFORMS = new Set(["instagram", "youtube"]);

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const user = await getAuthenticatedUser(request);
    const service = createServiceClient();
    const { redirectUrl, avatarId, platform = "instagram" } = await request.json().catch(() => ({}));

    if (!ALLOWED_PLATFORMS.has(platform)) {
      throw new Error(`Unsupported platform: ${platform}`);
    }

    const avatar = await resolveOwnedAvatar(service, user.id, avatarId);
    const profileId = await resolveZernioProfileForAvatar(service, avatar);

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
      `/connect/${platform}?${params.toString()}`,
    );

    console.log(
      "Zernio connect",
      platform,
      "profileId=", profileId,
      "response=", JSON.stringify(response).slice(0, 1500),
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
