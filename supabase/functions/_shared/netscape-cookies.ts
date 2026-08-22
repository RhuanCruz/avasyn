// Leitura do formato Netscape cookies.txt, o mesmo que o yt-dlp consome via --cookies.
//
// Existe uma cópia desta lógica em worker/health-report.mjs. Os dois lados precisam dela e
// não compartilham runtime (Deno aqui, Node lá), então a duplicação é deliberada -- ambas
// têm teste, e um comportamento só é considerado correto quando os dois testes concordam.

// Cookies que de fato carregam uma sessão logada do YouTube. Sem eles o yt-dlp navega como
// anônimo e leva bot-check, mesmo com o arquivo presente.
export const YOUTUBE_AUTH_COOKIES = [
  "__Secure-1PSID",
  "__Secure-3PSID",
  "SID",
  "HSID",
  "SSID",
  "LOGIN_INFO",
] as const;

export type NetscapeCookie = {
  domain: string;
  path: string;
  secure: boolean;
  /** Milissegundos epoch, ou null para cookie de sessão (campo 0 no arquivo). */
  expiresAt: number | null;
  name: string;
};

export type YoutubeCookieSummary = {
  present: boolean;
  total: number;
  authCookies: { name: string; expiresAt: string | null; expired: boolean }[];
  missingAuthCookies: string[];
  expired: boolean | null;
  expiresAt: string | null;
};

// Linha: domain \t includeSubdomains \t path \t secure \t expires \t name \t value
// `#HttpOnly_` prefixa um cookie real; qualquer outra linha com `#` é comentário.
export function parseNetscapeCookies(content: string | null | undefined): NetscapeCookie[] {
  return String(content ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && (!line.startsWith("#") || line.startsWith("#HttpOnly_")))
    .map((line) => line.replace(/^#HttpOnly_/, "").split("\t"))
    .filter((parts) => parts.length >= 7)
    .map((parts) => ({
      domain: parts[0],
      path: parts[2],
      secure: parts[3] === "TRUE",
      expiresAt: Number(parts[4]) > 0 ? Number(parts[4]) * 1000 : null,
      name: parts[5],
    }));
}

/** Resumo seguro de exibir: nomes e expiração, nunca o valor do cookie. */
export function summarizeYoutubeCookies(
  content: string | null | undefined,
  nowMs: number,
): YoutubeCookieSummary {
  if (!content) {
    return {
      present: false,
      total: 0,
      authCookies: [],
      missingAuthCookies: [...YOUTUBE_AUTH_COOKIES],
      expired: null,
      expiresAt: null,
    };
  }

  const cookies = parseNetscapeCookies(content);
  const byName = new Map(cookies.map((cookie) => [cookie.name, cookie]));

  const authCookies = YOUTUBE_AUTH_COOKIES
    .filter((name) => byName.has(name))
    .map((name) => {
      const expiresAt = byName.get(name)!.expiresAt;
      return {
        name,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        expired: expiresAt ? expiresAt <= nowMs : false,
      };
    });

  const withExpiry = authCookies.filter((cookie) => cookie.expiresAt);
  const earliest = withExpiry.length > 0
    ? withExpiry.reduce((min, cookie) => (cookie.expiresAt! < min.expiresAt! ? cookie : min))
    : null;

  return {
    present: true,
    total: cookies.length,
    authCookies,
    missingAuthCookies: YOUTUBE_AUTH_COOKIES.filter((name) => !byName.has(name)),
    // Um único cookie de sessão vencido já derruba a sessão inteira.
    expired: authCookies.length > 0 ? authCookies.some((cookie) => cookie.expired) : null,
    expiresAt: earliest?.expiresAt ?? null,
  };
}

/**
 * Recusa um arquivo que não vai funcionar, antes de ele substituir um que funciona.
 * Colar o texto errado (JSON de extensão, HTML, jar de outro site) falharia silenciosamente
 * só na hora do download, horas depois.
 */
export function validateYoutubeCookieJar(content: string): { ok: true } | { ok: false; error: string } {
  const trimmed = content.trim();

  if (trimmed === "") {
    return { ok: false, error: "O arquivo de cookies está vazio." };
  }

  const cookies = parseNetscapeCookies(trimmed);

  if (cookies.length === 0) {
    return {
      ok: false,
      error:
        "Não reconheci nenhum cookie. O arquivo precisa estar no formato Netscape "
        + "cookies.txt (colunas separadas por TAB), não JSON.",
    };
  }

  const names = new Set(cookies.map((cookie) => cookie.name));
  const hasAuth = YOUTUBE_AUTH_COOKIES.some((name) => names.has(name));

  if (!hasAuth) {
    return {
      ok: false,
      error:
        `Reconheci ${cookies.length} cookie(s), mas nenhum de sessão do YouTube `
        + `(${YOUTUBE_AUTH_COOKIES.join(", ")}). Exporte estando logado no youtube.com.`,
    };
  }

  return { ok: true };
}

/**
 * Aceita as duas formas que a pessoa tem em mãos: o conteúdo do cookies.txt ou o base64
 * que já estava em YOUTUBE_COOKIES_BASE64. Sem isso, migrar do env exigiria reexportar os
 * cookies do navegador só para mudar de formato.
 */
export function decodeCookieInput(raw: string): string {
  const trimmed = String(raw ?? "").trim();

  // Um cookies.txt de verdade tem TABs; base64 nunca tem.
  if (trimmed === "" || trimmed.includes("\t")) return trimmed;
  if (!/^[A-Za-z0-9+/=\s]+$/.test(trimmed)) return trimmed;

  try {
    const decoded = atob(trimmed.replace(/\s+/g, ""));
    return decoded.includes("\t") ? decoded : trimmed;
  } catch {
    // Não era base64 válido; devolve o original para a validação dar o erro específico.
    return trimmed;
  }
}
