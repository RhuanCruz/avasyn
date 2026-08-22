// Maps the raw failure strings produced by the video worker (and the yt-dlp
// stderr it wraps) onto messages that name the actual fix. The worker writes in
// English with stable tokens; this is the only place that turns them into pt-BR.
//
// Order matters: the aggregated "All YouTube download providers failed" message
// embeds the individual provider errors, so it must be inspected before the
// single-cause rules that would otherwise match its contents.

const YOUTUBE_PROVIDERS = ["HuntAPI", "WebAPI", "SaveNow", "Apify"];

// Um proxy recusando autenticação parece "site bloqueou" para quem lê o erro de longe, mas
// a correção é em outro lugar: credencial do proxy ou allowlist de IP no painel dele.
const PROXY_FAILURE = /HTTP Error 407|Proxy Authentication Required|Unable to connect to proxy|CONNECT tunnel failed|ProxyError/i;

const PROXY_FAILURE_MESSAGE =
  "O proxy configurado em YTDLP_PROXY recusou a conexão (erro 407, autenticação). "
  + "Confira usuário e senha; e se o painel do proxy estiver em modo \"IP Authorization\", "
  + "libere o IP do servidor lá em vez de usar usuário/senha.";

// Início de cada mensagem que esta função produz. Serve para torná-la idempotente.
//
// Sem isso, formatar duas vezes degrada o diagnóstico em vez de preservá-lo: a saída da
// cascata contém "YOUTUBE_COOKIES_BASE64", que casa com a regra de bot-check numa segunda
// passada, e a mensagem específica vira a genérica de cookie. Já aconteceu em produção.
const FORMATTED_PREFIXES = [
  "Falha ao importar mídia",
  "O worker de vídeo não está configurado",
  "O TikTok exige que o worker finja ser um navegador",
  "Só o yt-dlp está disponível para baixar do YouTube",
  "O proxy configurado em YTDLP_PROXY recusou a conexão",
  "Os provedores de download do YouTube falharam",
  "Nenhum provedor conseguiu baixar este vídeo do YouTube",
  "O YouTube bloqueou o download",
  "Este vídeo está privado ou foi removido",
  "A plataforma está limitando os downloads",
  "Este vídeo passa do limite de 300MB",
  "O yt-dlp não achou um MP4 para baixar",
  "A Apify não retornou um MP4 baixável",
  "A API SaveNow não retornou um vídeo baixável",
  "Não foi possível baixar este link",
];

export function formatMediaImportError(message: string | null): string {
  if (!message) return "Falha ao importar mídia";

  const trimmed = message.trim();
  if (FORMATTED_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) {
    return message;
  }

  if (isWorkerNotDeployed(message)) {
    return "O worker de vídeo não está configurado ou está desatualizado. Faça o deploy da versão mais recente e configure VIDEO_WORKER_URL.";
  }

  // TikTok (and a few other sites) need yt-dlp to impersonate a browser, which
  // only works when the image ships the curl-cffi extra.
  if (/cannot impersonate a browser|impersonate target|curl[-_]cffi|attempting impersonation/i.test(message)) {
    return "O TikTok exige que o worker finja ser um navegador. Reconstrua a imagem do worker com yt-dlp[default,curl-cffi] e rode de novo.";
  }

  // Antes da cascata: um proxy recusando conexão é causa definitiva e acionável, e a
  // mensagem agregada esconderia esse detalhe atrás de "o YouTube bloqueou".
  if (PROXY_FAILURE.test(message)) {
    return PROXY_FAILURE_MESSAGE;
  }

  if (/All YouTube download providers failed/i.test(message)) {
    return formatYouTubeCascadeError(message);
  }

  if (/bot-checking the worker|Sign in to confirm you.?re not a bot|cookies-from-browser|--cookies|YOUTUBE_COOKIES_BASE64/i.test(message)) {
    return "O YouTube bloqueou o download. Atualize YOUTUBE_COOKIES_BASE64 no worker com cookies recém-exportados e rode novamente.";
  }

  if (/private or unavailable|Video unavailable|This video is private|has been removed/i.test(message)) {
    return "Este vídeo está privado ou foi removido, então não dá para baixar. Escolha outro.";
  }

  if (/rate.?limit|HTTP Error 429|Too Many Requests/i.test(message)) {
    return "A plataforma está limitando os downloads do worker. Espere alguns minutos e tente de novo.";
  }

  if (/larger than the worker|max-filesize/i.test(message)) {
    return "Este vídeo passa do limite de 300MB de download do worker. Escolha um vídeo mais curto.";
  }

  if (/no downloadable MP4 format|Requested format is not available|No video formats found/i.test(message)) {
    return "O yt-dlp não achou um MP4 para baixar — o extractor provavelmente está desatualizado. Reconstrua a imagem do worker.";
  }

  if (/returned demo output|actor subscription|APIFY_YOUTUBE_DOWNLOADER_ACTOR_ID|downloadable YouTube video URL/i.test(message)) {
    return "A Apify não retornou um MP4 baixável. Verifique se o actor do YouTube está liberado/subscrito na sua conta Apify.";
  }

  if (/SAVENOW_API_KEY|SaveNow/i.test(message)) {
    return "A API SaveNow não retornou um vídeo baixável. Verifique a chave/formato no worker e tente novamente.";
  }

  if (/does not support this|Unsupported URL|Unable to handle request/i.test(message)) {
    return "Não foi possível baixar este link — o yt-dlp não suporta essa URL. Tente outro vídeo.";
  }

  return message;
}

function isWorkerNotDeployed(message: string) {
  return /VIDEO_WORKER_URL is not configured|worker search endpoint not found|Rebuild\/redeploy the video worker/i.test(message);
}

/**
 * The cascade message looks like:
 * `All YouTube download providers failed. HuntAPI: not configured | SaveNow: 502 | yt-dlp: ...`
 * Which providers were even wired up changes what the user should do about it.
 */
function formatYouTubeCascadeError(message: string) {
  const details = message.split(/All YouTube download providers failed\.?\s*/i)[1]?.trim() ?? "";
  const configured = YOUTUBE_PROVIDERS.filter(
    (provider) => !new RegExp(`${provider}: not configured`, "i").test(details),
  );

  // Sem provider é uma configuração legítima (só yt-dlp), não um erro.
  //
  // O detalhe do yt-dlp vai junto: sem ele esta mensagem dizia "o YouTube bloqueou" para
  // qualquer falha -- inclusive quando a causa era o proxy recusando autenticação -- e
  // mandava conferir cookie, que não tinha nada a ver.
  if (configured.length === 0) {
    const ytdlpDetail = details.split("|").map((part) => part.trim()).filter(Boolean).pop();
    const suffix = ytdlpDetail ? ` Detalhe do yt-dlp: ${ytdlpDetail}` : "";

    return `Só o yt-dlp está disponível para baixar do YouTube, e ele não conseguiu.${suffix}`;
  }

  // Quando um provider PAGO falha, ele é a causa acionável — o cookie é só o último
  // recurso que sobrou depois. Dizer "atualize os cookies" aqui manda a pessoa mexer no
  // lugar errado, que foi exatamente o que aconteceu na primeira vez que este erro apareceu.
  const failures = configured.map((provider) => {
    const match = details.match(new RegExp(`${provider}: ([^|]+)`, "i"));
    return match ? `${provider}: ${match[1].trim()}` : provider;
  });

  const botChecked = /bot-checking the worker|not a bot|YOUTUBE_COOKIES_BASE64/i.test(details);
  const suffix = botChecked
    ? " Sem eles sobrou o yt-dlp, que levou bot-check do YouTube — então nem o fallback por cookie passou."
    : "";

  return `Os provedores de download do YouTube falharam — ${failures.join(" · ")}.${suffix}`;
}
