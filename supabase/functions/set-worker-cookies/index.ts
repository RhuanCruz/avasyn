// Grava o jar de cookies do YouTube que o worker lê em runtime.
//
// Existe para tirar o cookie de YOUTUBE_COOKIES_BASE64: como variável de ambiente, trocar
// um cookie vencido exigia editar o stack no Portainer e recriar o container. Aqui a troca
// é um paste na tela, sem deploy.
//
// O valor nunca volta para o cliente. A resposta traz só o resumo (nomes e expiração), o
// mesmo que a tela de status mostra.

import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { describeError, isMissingTableError } from "../_shared/errors.ts";
import {
  decodeCookieInput,
  summarizeYoutubeCookies,
  validateYoutubeCookieJar,
} from "../_shared/netscape-cookies.ts";
import { createServiceClient, getAuthenticatedUser } from "../_shared/supabase.ts";

const CREDENTIAL_KEY = "youtube_cookies";

// Um jar do YouTube tem alguns KB. O teto existe para um paste errado (um vídeo, um dump)
// não virar uma linha gigante no banco.
const MAX_BYTES = 256 * 1024;

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const user = await getAuthenticatedUser(request);
    const body = await request.json();
    const raw = String(body.cookies ?? "");

    if (new TextEncoder().encode(raw).length > MAX_BYTES) {
      return jsonResponse(
        { error: "Arquivo de cookies grande demais (máximo 256KB)." },
        { status: 400 },
      );
    }

    const content = decodeCookieInput(raw);
    const validation = validateYoutubeCookieJar(content);

    // Validar antes de gravar: um jar inválido substituindo um que funciona só apareceria
    // horas depois, como job falhando.
    if (!validation.ok) {
      return jsonResponse({ error: validation.error }, { status: 400 });
    }

    const metadata = summarizeYoutubeCookies(content, Date.now());
    const updatedAt = new Date().toISOString();
    const service = createServiceClient();

    const { error } = await service
      .from("worker_credentials")
      .upsert(
        {
          key: CREDENTIAL_KEY,
          value: content,
          metadata,
          updated_at: updatedAt,
          updated_by: user.id,
        },
        { onConflict: "key" },
      );

    // A causa mais provável de falhar aqui é a edge function ter sido publicada sem a
    // migration ter rodado. O erro cru do Postgres não diz o que fazer a respeito.
    if (isMissingTableError(error)) {
      return jsonResponse(
        {
          error:
            "A tabela worker_credentials não existe no banco. Rode `supabase db push` "
            + "para aplicar a migration e tente salvar de novo.",
        },
        { status: 400 },
      );
    }

    if (error) throw error;

    return jsonResponse({ ok: true, metadata, updatedAt });
  } catch (error) {
    // describeError e não `instanceof Error`: o supabase-js lança PostgrestError, um objeto
    // simples, e o teste de instância transformava toda falha de banco em "Unknown error".
    return jsonResponse({ error: describeError(error) }, { status: 400 });
  }
});
