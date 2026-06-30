import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { getAuthenticatedUser } from "../_shared/supabase.ts";
import { hedraRequest, normalizeHedraModels } from "../_shared/hedra.ts";

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    await getAuthenticatedUser(request);
    const rawModels = await hedraRequest<unknown>("/models");
    return jsonResponse(normalizeHedraModels(rawModels));
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});
