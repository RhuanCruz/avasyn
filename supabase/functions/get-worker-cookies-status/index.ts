// Estado do jar de cookies do YouTube, para a tela mostrar se a sessão ainda vale.
//
// Só devolve metadata. O valor fica no banco, acessível apenas pelo service role e pelo
// worker -- em nenhum momento chega ao navegador.

import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { describeError, isMissingTableError } from "../_shared/errors.ts";
import { summarizeYoutubeCookies } from "../_shared/netscape-cookies.ts";
import { createServiceClient, getAuthenticatedUser } from "../_shared/supabase.ts";

const CREDENTIAL_KEY = "youtube_cookies";

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    await getAuthenticatedUser(request);

    const service = createServiceClient();
    const { data, error } = await service
      .from("worker_credentials")
      .select("value, updated_at, updated_by")
      .eq("key", CREDENTIAL_KEY)
      .maybeSingle();

    // Sem a migration aplicada a tela não deve quebrar: reporta "não configurado" e deixa
    // o aviso explícito para quem for salvar.
    if (isMissingTableError(error)) {
      return jsonResponse({
        configured: false,
        migrationPending: true,
        metadata: summarizeYoutubeCookies(null, Date.now()),
        updatedAt: null,
      });
    }

    if (error) throw error;

    if (!data) {
      return jsonResponse({
        configured: false,
        metadata: summarizeYoutubeCookies(null, Date.now()),
        updatedAt: null,
      });
    }

    // Recalcula em vez de devolver o metadata gravado: aquele foi calculado na hora da
    // escrita, então `expired` estaria congelado em "false" para sempre.
    return jsonResponse({
      configured: true,
      metadata: summarizeYoutubeCookies(data.value as string, Date.now()),
      updatedAt: data.updated_at,
    });
  } catch (error) {
    return jsonResponse({ error: describeError(error) }, { status: 400 });
  }
});
