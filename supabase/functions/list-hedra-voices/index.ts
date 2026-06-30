import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { getAuthenticatedUser } from "../_shared/supabase.ts";
import { hedraRequest, normalizeHedraVoices } from "../_shared/hedra.ts";

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    await getAuthenticatedUser(request);
    const rawVoices = await hedraRequest<unknown>("/voices");
    return jsonResponse({ voices: normalizeHedraVoices(rawVoices) });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});
