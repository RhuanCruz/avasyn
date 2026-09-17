// Rotacao de proxy para o yt-dlp.
//
// Existe porque o bloqueio do YouTube nao e por IP nem por video isoladamente, e sim pela
// combinacao dos dois. Medido com cinco proxies e dois videos: todos os cinco baixaram o
// video "facil"; no outro, quatro levaram bot-check e apenas um passou. Um proxy fixo,
// portanto, falha de forma aparentemente aleatoria -- e a mensagem de erro que sobra manda
// trocar cookie, que nao tem nada a ver.
//
// Com uma lista, uma falha de bloqueio vira "tenta o proximo" em vez de derrubar o job.

/** Aceita um proxy so ou varios separados por virgula, espaco ou quebra de linha. */
export function parseProxyList(value) {
  return String(value ?? "")
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Distingue "este proxy nao serviu" de "este video nao existe".
 *
 * Só a primeira justifica gastar outro proxy: repetir um vídeo privado nove vezes atrasa o
 * job em minutos e termina no mesmo lugar.
 */
export function isRetriableProxyFailure(message) {
  const text = String(message ?? "");

  // Bloqueio do site: outro IP pode passar.
  if (/Sign in to confirm you.?re not a bot|bot-checking the worker|HTTP Error 403|HTTP Error 429|Too Many Requests/i.test(text)) {
    return true;
  }

  // Problema do proxy em si (sem crédito, credencial recusada, túnel caiu).
  if (/HTTP Error 40[27]|Proxy Authentication Required|Payment Required|Unable to connect to proxy|CONNECT tunnel failed|ProxyError/i.test(text)) {
    return true;
  }

  return false;
}

/**
 * Esconde o segredo do proxy nos logs: `http://user:senha@host:porta` vira `host:porta`.
 * Sem isso, cada troca de proxy escreveria a credencial no log do container.
 */
export function describeProxy(proxyUrl) {
  if (!proxyUrl) return "sem proxy";
  try {
    const url = new URL(proxyUrl);
    return url.port ? `${url.hostname}:${url.port}` : url.hostname;
  } catch {
    return "proxy invalido";
  }
}
