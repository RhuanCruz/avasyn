// Maps the raw failure strings produced by the video worker (and the yt-dlp
// stderr it wraps) onto messages that name the actual fix. The worker writes in
// English with stable tokens; this is the only place that turns them into pt-BR.
//
// Order matters: the aggregated "All YouTube download providers failed" message
// embeds the individual provider errors, so it must be inspected before the
// single-cause rules that would otherwise match its contents.

const YOUTUBE_PROVIDERS = ["HuntAPI", "WebAPI", "SaveNow", "Apify"];

export function formatMediaImportError(message: string | null): string {
  if (!message) return "Falha ao importar mídia";

  if (isWorkerNotDeployed(message)) {
    return "O worker de vídeo não está configurado ou está desatualizado. Faça o deploy da versão mais recente e configure VIDEO_WORKER_URL.";
  }

  // TikTok (and a few other sites) need yt-dlp to impersonate a browser, which
  // only works when the image ships the curl-cffi extra.
  if (/cannot impersonate a browser|impersonate target|curl[-_]cffi|attempting impersonation/i.test(message)) {
    return "O TikTok exige que o worker finja ser um navegador. Reconstrua a imagem do worker com yt-dlp[default,curl-cffi] e rode de novo.";
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
  const unconfigured = YOUTUBE_PROVIDERS.filter((provider) =>
    new RegExp(`${provider}: not configured`, "i").test(details),
  );

  if (unconfigured.length === YOUTUBE_PROVIDERS.length) {
    return "Nenhum provedor de download do YouTube está configurado no worker (HuntAPI, WebAPI, SaveNow ou Apify), então sobrou só o yt-dlp — e o YouTube bloqueou. Configure uma dessas chaves no worker.";
  }

  if (/bot-checking the worker|not a bot|YOUTUBE_COOKIES_BASE64/i.test(details)) {
    return "Os provedores de download falharam e o YouTube bot-checkou o yt-dlp. Atualize YOUTUBE_COOKIES_BASE64 no worker e rode novamente.";
  }

  return details
    ? `Nenhum provedor conseguiu baixar este vídeo do YouTube. Detalhes do worker: ${details}`
    : "Nenhum provedor conseguiu baixar este vídeo do YouTube.";
}
