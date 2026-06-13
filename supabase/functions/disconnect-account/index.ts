import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { createServiceClient, getAuthenticatedUser } from "../_shared/supabase.ts";

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const user = await getAuthenticatedUser(request);
    const service = createServiceClient();
    const body = await request.json();
    const accountId = String(body.accountId ?? "").trim();

    if (!accountId) throw new Error("accountId is required");

    const { data: account, error: fetchError } = await service
      .from("social_accounts")
      .select("id, user_id, avatar_id")
      .eq("id", accountId)
      .eq("user_id", user.id)
      .single();

    if (fetchError || !account) throw new Error("Account not found");

    const { error } = await service
      .from("social_accounts")
      .delete()
      .eq("id", accountId);

    if (error) throw error;

    return jsonResponse({ ok: true });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});
