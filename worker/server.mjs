import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createWriteStream, openAsBlob } from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { r2UploadFile, r2DownloadFile } from "./r2.mjs";

import { createClient } from "@supabase/supabase-js";

import { createFfmpegArgs } from "./ffmpeg-options.mjs";
import { getClipSource, getSourceVideoIdFromClipUrl } from "./job-media.mjs";
import { describeYtDlpFailure } from "./ytdlp-errors.mjs";
import { parseImpersonateTargets, summarizeYoutubeCookies } from "./health-report.mjs";
import {
  buildTikTokSearchInput,
  buildTikTokDownloadInput,
  findApifyTikTokVideoDownloadUrl,
  normalizeApifyTikTokSearchResult,
  normalizeApifyTikTokVideoCandidate,
  runApifyTikTokActor,
} from "./apify-tiktok.mjs";
import {
  buildYouTubeDownloadInput,
  findApifyYouTubeDownloadUrl,
  isApifyYouTubeDemoResult,
  normalizeApifyYouTubeCandidate,
  runApifyYouTubeDownloader,
} from "./apify-youtube.mjs";
import {
  normalizeSaveNowYouTubeCandidate,
  runSaveNowYouTubeDownloader,
} from "./savenow-youtube.mjs";
import {
  normalizeWebApiYouTubeCandidate,
  runWebApiYouTubeDownloader,
} from "./webapi-youtube.mjs";
import {
  normalizeHuntApiYouTubeCandidate,
  runHuntApiYouTubeDownloader,
} from "./huntapi-youtube.mjs";
import {
  createGalleryDlArgs,
  detectPlatform,
  sanitizeExternalId,
} from "./media-import.mjs";
import { parseTikTokSearchOutput } from "./tiktok-search.mjs";
import {
  createTikTokSearchArgs,
  createYtDlpArgs,
  createYtDlpDownloadArgs,
} from "./ytdlp-options.mjs";

const port = Number(process.env.PORT ?? 8080);
const storageBackend = process.env.STORAGE_BACKEND ?? "";
const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const workerSecret = process.env.VIDEO_WORKER_SECRET;
const ytdlpNodePath = process.env.YTDLP_NODE_PATH ?? "/usr/local/bin/node";
const ytdlpProxy = process.env.YTDLP_PROXY;
const youtubeCookiesBase64 = process.env.YOUTUBE_COOKIES_BASE64;
const youtubeCookies = process.env.YOUTUBE_COOKIES;
const instagramCookiesBase64 = process.env.INSTAGRAM_COOKIES_BASE64;
const apifyToken = process.env.APIFY_TOKEN;
const apifyTikTokActorId = process.env.APIFY_TIKTOK_ACTOR_ID ?? "clockworks/tiktok-scraper";
const apifyYouTubeDownloaderActorId = process.env.APIFY_YOUTUBE_DOWNLOADER_ACTOR_ID
  ?? "epctex/youtube-video-downloader";
const apifyYouTubeQuality = process.env.APIFY_YOUTUBE_QUALITY ?? "720";
const saveNowApiKey = process.env.SAVENOW_API_KEY;
const saveNowFormat = process.env.SAVENOW_FORMAT ?? "720";
const huntApiKey = process.env.HUNTAPI_API_KEY;
const huntApiVideoDownloadEndpoint = process.env.HUNTAPI_VIDEO_DOWNLOAD_ENDPOINT;
const huntApiDownloadType = process.env.HUNTAPI_DOWNLOAD_TYPE ?? "audio_video";
const huntApiMaxDuration = Number(process.env.HUNTAPI_MAX_DURATION ?? 300);
const huntApiVideoQuality = process.env.HUNTAPI_VIDEO_QUALITY ?? "best";
const huntApiVideoFormat = process.env.HUNTAPI_VIDEO_FORMAT ?? "mp4";
const huntApiTimeoutSeconds = Number(process.env.HUNTAPI_TIMEOUT_SECONDS ?? 600);
const huntApiPollIntervalMs = Number(process.env.HUNTAPI_POLL_INTERVAL_MS ?? 2000);
const webApiYouTubeApiKey = process.env.WEBAPI_YOUTUBE_API_KEY;
const webApiYouTubeEndpoint = process.env.WEBAPI_YOUTUBE_ENDPOINT;
const webApiYouTubeAuthMode = process.env.WEBAPI_YOUTUBE_AUTH_MODE ?? "x-api-key";
const webApiYouTubeFormat = process.env.WEBAPI_YOUTUBE_FORMAT ?? "720";
const workerRevision = process.env.AVASYN_WORKER_REVISION ?? "local";
const instagramDownloadDelaySeconds = Number(
  process.env.INSTAGRAM_DOWNLOAD_DELAY_SECONDS ?? 2,
);
const maxConcurrentJobs = Math.max(1, Number(process.env.WORKER_MAX_CONCURRENT_JOBS ?? 1));
const maxQueuedJobs = Math.max(1, Number(process.env.WORKER_MAX_QUEUED_JOBS ?? 3));

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

// Fila interna com concorrência limitada. Antes disso cada POST começava um job na
// hora, em paralelo e sem teto: uma automação que criava 10 jobs de uma vez punha 10
// downloads + 10 ffmpeg simultâneos num host de 2 CPUs, e o OOM killer matava o worker
// (SIGKILL/137) no meio do render — deixando os jobs em voo órfãos em "processing".
// ffmpeg é CPU-bound, então mais de um render simultâneo não ganha tempo, só sobe o
// pico de memória. Acima de maxQueuedJobs devolvemos 503 para o chamador segurar o
// trabalho, em vez de acumular tudo aqui e morrer de novo.
const jobQueue = [];
let activeJobs = 0;

// Como container na Vercel, nada disso vale: cada requisicao pode cair numa instancia
// diferente, a instancia some depois de responder, e trabalho iniciado fora da requisicao
// e perdido. La o job roda DENTRO da requisicao. Isso so e viavel porque o cancelamento de
// request na Vercel e opt-in e vem desligado -- o chamador desconectar (o reel-processor
// dispara e nao espera) nao mata o render em andamento.
//
// A fila continua existindo para o deploy em VPS, onde ela protege um host de 2 vCPU de
// rodar varios ffmpeg ao mesmo tempo e levar OOM.
const statelessRuntime = Boolean(process.env.VERCEL);

function queueDepth() {
  return activeJobs + jobQueue.length;
}

function enqueueTask(label, run) {
  jobQueue.push({ label, run });
  drainQueue();
}

function drainQueue() {
  while (activeJobs < maxConcurrentJobs && jobQueue.length > 0) {
    const task = jobQueue.shift();
    activeJobs += 1;
    Promise.resolve()
      .then(task.run)
      // O status do job já é gravado no banco por processJob (rendered/error), então
      // aqui só registramos: o request HTTP que enfileirou já respondeu faz tempo.
      .catch((error) => console.error(`${task.label} failed:`, error))
      .finally(() => {
        activeJobs -= 1;
        drainQueue();
      });
  }
}

createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") {
      return sendJson(response, 200, await buildHealthPayload());
    }

    if (request.method === "POST" && request.url === "/search-tiktok") {
      if (workerSecret && request.headers.authorization !== `Bearer ${workerSecret}`) {
        return sendJson(response, 401, { error: "Unauthorized" });
      }

      const body = await readJson(request);
      const query = String(body.query ?? "").trim();
      const limit = clampLimit(body.limit);
      if (!query) {
        return sendJson(response, 400, { error: "query is required" });
      }

      const results = await searchTikTok(query, limit);
      return sendJson(response, 200, { results });
    }

    if (request.method === "POST" && request.url === "/process-media-import") {
      if (workerSecret && request.headers.authorization !== `Bearer ${workerSecret}`) {
        return sendJson(response, 401, { error: "Unauthorized" });
      }

      const body = await readJson(request);
      if (!body.importId) {
        return sendJson(response, 400, { error: "importId is required" });
      }

      await processMediaImport(String(body.importId));
      return sendJson(response, 200, { ok: true, importId: body.importId });
    }

    if (request.method === "POST" && request.url === "/assemble-scene-clip") {
      if (workerSecret && request.headers.authorization !== `Bearer ${workerSecret}`) {
        return sendJson(response, 401, { error: "Unauthorized" });
      }

      const body = await readJson(request);
      const sceneId = String(body.sceneId ?? "").trim();
      if (!sceneId) {
        return sendJson(response, 400, { error: "sceneId is required" });
      }

      await assembleSceneClip({
        sceneId,
        userId: String(body.userId ?? "").trim(),
        videoUrl: String(body.videoUrl ?? "").trim(),
        audioUrl: String(body.audioUrl ?? "").trim(),
        imageUrl: String(body.imageUrl ?? "").trim(),
      });
      return sendJson(response, 200, { ok: true, sceneId });
    }

    if (request.method !== "POST" || request.url !== "/process-job") {
      return sendJson(response, 404, { error: "Not found" });
    }

    if (workerSecret && request.headers.authorization !== `Bearer ${workerSecret}`) {
      return sendJson(response, 401, { error: "Unauthorized" });
    }

    const body = await readJson(request);
    if (!body.jobId) {
      return sendJson(response, 400, { error: "jobId is required" });
    }

    const jobId = String(body.jobId);

    // Em runtime stateless (container na Vercel) o trabalho tem que acontecer dentro da
    // requisicao -- ver o comentario em statelessRuntime. Sem fila: quem limita a
    // concorrencia ali e o autoscaling, uma instancia por render.
    if (statelessRuntime) {
      await processJob(jobId);
      return sendJson(response, 200, { ok: true, jobId });
    }

    if (queueDepth() >= maxQueuedJobs) {
      return sendJson(response, 503, {
        error: "Worker busy",
        queued: queueDepth(),
      });
    }

    // Responde na hora e processa em background: um render leva minutos e a edge
    // function que despacha não sobrevive tanto tempo. Segurar a conexão fazia o
    // reel-processor marcar error por timeout enquanto o worker ainda estava
    // renderizando o mesmo job. Quem grava o resultado é processJob, no banco.
    enqueueTask(`job ${jobId}`, () => processJob(jobId));
    return sendJson(response, 202, { accepted: true, jobId, queued: queueDepth() });
  } catch (error) {
    console.error(error);
    return sendJson(response, 500, {
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}).listen(port, () => {
  console.log(`Avasyn video worker listening on ${port}`);
});

// Narração: build the scene clip with the narration voice-over. Two modes:
//   - Ken Burns (imageUrl): a still image with a subtle slow zoom (the person never
//     moves/talks). This is the default — no generative video.
//   - Motion mux (videoUrl): a short silent motion clip looped under the narration
//     (opt-in "movimento IA"). Called by render/sync-scene-clip.
async function assembleSceneClip({ sceneId, userId, videoUrl, audioUrl, imageUrl }) {
  if (!audioUrl) throw new Error("audioUrl is required");
  if (!videoUrl && !imageUrl) throw new Error("videoUrl or imageUrl is required");

  const workdir = await mkdtemp(join(tmpdir(), "avasyn-scene-"));
  const audioPath = join(workdir, "narration.mp3");
  const outputPath = join(workdir, "scene.mp4");

  try {
    await downloadHttpFile(audioUrl, audioPath);

    if (imageUrl) {
      const imagePath = join(workdir, "still.jpg");
      await downloadHttpFile(imageUrl, imagePath);
      await runKenBurns({ imagePath, audioPath, outputPath });
    } else {
      const videoPath = join(workdir, "motion.mp4");
      await downloadHttpFile(videoUrl, videoPath);
      await runCommand("ffmpeg", [
        "-y",
        "-stream_loop", "-1", "-i", videoPath,
        "-i", audioPath,
        "-map", "0:v", "-map", "1:a",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-shortest", "-r", "30",
        outputPath,
      ]);
    }

    const storagePath = `${userId}/scene-${sceneId}.mp4`;
    await uploadStorageFile("generated-reels", storagePath, outputPath, "video/mp4");

    await updateScene(sceneId, {
      clip_status: "ready",
      clip_url: null,
      error_message: null,
      metadataPatch: { clip_path: storagePath, clip_bucket: "generated-reels", needs_mux: false },
    });
  } catch (error) {
    await updateScene(sceneId, {
      clip_status: "error",
      error_message: error instanceof Error ? error.message : "Falha ao montar a narração",
    });
    throw error;
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

// Still image + narration: 9:16 with a subtle slow zoom (Ken Burns). Length follows
// the audio (-shortest against the looped image). Falls back to a static frame if
// the zoompan filter isn't available.
async function runKenBurns({ imagePath, audioPath, outputPath }) {
  const scaleCrop = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920";
  try {
    await runCommand("ffmpeg", [
      "-y",
      "-loop", "1", "-i", imagePath,
      "-i", audioPath,
      "-filter_complex",
      `[0:v]${scaleCrop},zoompan=z='min(zoom+0.0004,1.12)':d=1:s=1080x1920:fps=30,format=yuv420p[v]`,
      "-map", "[v]", "-map", "1:a",
      "-c:v", "libx264", "-c:a", "aac",
      "-shortest", "-r", "30",
      outputPath,
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/zoompan|No such filter/i.test(message)) throw error;
    await runCommand("ffmpeg", [
      "-y",
      "-loop", "1", "-i", imagePath,
      "-i", audioPath,
      "-vf", `${scaleCrop},format=yuv420p`,
      "-map", "0:v", "-map", "1:a",
      "-c:v", "libx264", "-c:a", "aac",
      "-shortest", "-r", "30",
      outputPath,
    ]);
  }
}

async function updateScene(sceneId, { clip_status, clip_url, error_message, metadataPatch }) {
  const values = { clip_status, updated_at: new Date().toISOString() };
  if (clip_url !== undefined) values.clip_url = clip_url;
  if (error_message !== undefined) values.error_message = error_message;
  if (metadataPatch) {
    const { data } = await supabase
      .from("presenter_video_scenes")
      .select("metadata")
      .eq("id", sceneId)
      .maybeSingle();
    values.metadata = { ...(data?.metadata ?? {}), ...metadataPatch };
  }
  const { error } = await supabase.from("presenter_video_scenes").update(values).eq("id", sceneId);
  if (error) throw error;
}

async function processJob(jobId) {
  const job = await findJob(jobId);

  // Segunda linha de defesa contra republicação. O status não serve para este teste porque
  // quem despacha já o moveu para "processing"; posted_at/zernio_post_id são os únicos
  // sinais duráveis de que este job foi ao ar. Importa porque o render termina gravando
  // "rendered", o que reabre a trava de idempotência do post-to-zernio e faria o mesmo
  // vídeo ser publicado de novo.
  if (job.posted_at || job.zernio_post_id) {
    console.warn(`job ${jobId} ja foi publicado (posted_at=${job.posted_at ?? "null"}); ignorando`);
    await updateJob(jobId, {
      status: job.posted_at ? "posted" : "posting",
      error_message: null,
    });
    return;
  }

  await hydrateSourceVideo(job);

  await updateJob(jobId, { status: "processing", error_message: null });

  const workdir = await mkdtemp(join(tmpdir(), "avasyn-"));
  const clipPath = join(workdir, "clip.mp4");
  const reactionPath = join(workdir, "reaction.mp4");
  const outputPath = join(workdir, "output.mp4");

  try {
    const clipSource = getClipSource(job);

    if (clipSource.type === "storage") {
      await downloadStorageFile("source-videos", clipSource.path, clipPath);
    } else {
      await downloadClipUrl(clipSource.url, clipPath, workdir);
    }

    const reactionPositionX = job.reaction_videos.position_x ?? 0;
    const reactionPositionY = job.reaction_videos.position_y ?? 0;
    await downloadStorageFile("reaction-videos", job.reaction_videos.storage_path, reactionPath);

    await runFfmpegWithDrawTextFallback({
      clipPath,
      outputPath,
      overlayText: job.overlay_text,
      reactionPositionX,
      reactionPositionY,
      reactionPath,
    });

    const storagePath = `${job.user_id}/${job.id}.mp4`;
    await uploadStorageFile("generated-reels", storagePath, outputPath, "video/mp4");

    await updateJob(jobId, { status: "rendered", output_path: storagePath });

    if (job.account_id) {
      const postResponse = await fetch(`${supabaseUrl}/functions/v1/post-to-zernio`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jobId }),
      });

      if (!postResponse.ok) {
        throw new Error(`post-to-zernio failed: ${await postResponse.text()}`);
      }
    }
  } catch (error) {
    await updateJob(jobId, {
      status: "error",
      error_message: error instanceof Error ? error.message : "Unknown error",
    });
    throw error;
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

async function findJob(jobId) {
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const { data, error } = await supabase
      .from("reel_jobs")
      .select("*, reaction_videos(storage_path, position_x, position_y), source_videos(storage_path)")
      .eq("id", jobId)
      .maybeSingle();

    if (data) return data;
    lastError = error;
    if (attempt < 3) await sleep(500 * attempt);
  }

  const details = lastError
    ? [lastError.code, lastError.message, lastError.details].filter(Boolean).join(": ")
    : "record is not visible to the worker";
  throw new Error(`Job ${jobId} not found: ${details}`);
}

async function searchTikTok(query, limit) {
  if (apifyToken) {
    const items = await runApifyTikTokActor({
      actorId: apifyTikTokActorId,
      input: buildTikTokSearchInput(query, limit),
      limit,
      token: apifyToken,
      timeoutSeconds: 120,
    });
    return items
      .map(normalizeApifyTikTokSearchResult)
      .filter(Boolean)
      .slice(0, limit);
  }

  const workdir = await mkdtemp(join(tmpdir(), "avasyn-search-"));

  try {
    // No cookies here on purpose: the only jar we hold is a YouTube session and
    // yt-dlp would send it to TikTok, leaking it for nothing in return.
    const output = await runCommand("yt-dlp", createTikTokSearchArgs({
      query,
      limit,
      nodePath: ytdlpNodePath,
      proxyUrl: ytdlpProxy,
    }), { captureStdout: true });

    return parseTikTokSearchOutput(output);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

async function processMediaImport(importId) {
  const mediaImport = await findMediaImport(importId);

  await updateMediaImport(importId, {
    status: "processing",
    error_message: null,
  });

  const workdir = await mkdtemp(join(tmpdir(), "avasyn-import-"));
  let processed = 0;

  try {
    const candidates = mediaImport.type === "instagram_profile"
      ? await downloadInstagramProfile(mediaImport, workdir)
      : [await downloadImportUrl(mediaImport.input, workdir)];

    await updateMediaImport(importId, { total_items: candidates.length });

    // Grava a cada item, e não só no fim: uma importação que falha no meio ("partial")
    // ainda deixa registrado o que já entrou, e o frontend consegue usar.
    const sourceVideoIds = [];
    for (const candidate of candidates) {
      sourceVideoIds.push(await storeImportedVideo(mediaImport, candidate, workdir));
      processed += 1;
      await updateMediaImport(importId, {
        processed_items: processed,
        source_video_ids: sourceVideoIds,
      });
    }

    await updateMediaImport(importId, {
      status: "completed",
      completed_at: new Date().toISOString(),
    });
  } catch (error) {
    await updateMediaImport(importId, {
      status: processed > 0 ? "partial" : "error",
      error_message: error instanceof Error ? error.message : "Unknown import error",
      processed_items: processed,
      completed_at: new Date().toISOString(),
    });
    throw error;
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

async function findMediaImport(importId) {
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const { data, error } = await supabase
      .from("media_imports")
      .select("*")
      .eq("id", importId)
      .maybeSingle();

    if (data) return data;
    lastError = error;
    if (attempt < 3) await sleep(500 * attempt);
  }

  const details = lastError
    ? [lastError.code, lastError.message, lastError.details].filter(Boolean).join(": ")
    : "record is not visible to the worker";
  throw new Error(`Media import ${importId} not found: ${details}`);
}

// Downloads a clip URL for a render job. Kept in sync with downloadImportUrl so
// a link behaves the same whether it comes from the library import or a job.
async function downloadClipUrl(clipUrl, clipPath, workdir) {
  const platform = detectPlatform(clipUrl);

  if (platform === "youtube") {
    const cookiesPath = await writeYoutubeCookiesFile(workdir);
    await downloadYouTubeWithPreferredFallback({ clipPath, clipUrl, cookiesPath });
    return;
  }

  if (platform === "tiktok" && apifyToken) {
    // Apify first: yt-dlp's TikTok extractor breaks often and needs browser
    // impersonation (curl_cffi) that older worker images do not ship.
    try {
      await downloadTikTokImportUrl(clipUrl, clipPath);
      return;
    } catch (error) {
      console.warn(
        `Apify TikTok download failed, falling back to yt-dlp: ${formatErrorMessage(error)}`,
      );
    }
  }

  const cookiesPath = await writeCookiesForPlatform(platform, workdir);
  try {
    await runCommand("yt-dlp", createYtDlpArgs({
      clipPath,
      clipUrl,
      cookiesPath,
      nodePath: ytdlpNodePath,
      proxyUrl: ytdlpProxy,
    }));
  } catch (error) {
    throw new Error(describeYtDlpFailure(platform, formatErrorMessage(error)));
  }
}

async function downloadImportUrl(url, workdir) {
  const videoPath = join(workdir, "import.mp4");
  const infoPath = join(workdir, "import.info.json");
  const platform = detectPlatform(url);
  if (platform === "tiktok" && apifyToken) {
    try {
      return await downloadTikTokImportUrl(url, videoPath);
    } catch (error) {
      console.warn(
        `Apify TikTok import failed, falling back to yt-dlp: ${formatErrorMessage(error)}`,
      );
    }
  }
  if (platform === "youtube") {
    const cookiesPath = await writeYoutubeCookiesFile(workdir);
    return downloadYouTubeImportUrl(url, videoPath, infoPath, cookiesPath);
  }

  const cookiesPath = await writeCookiesForPlatform(platform, workdir);
  try {
    await runCommand("yt-dlp", [
      ...createYtDlpDownloadArgs({
        cookiesPath,
        nodePath: ytdlpNodePath,
        proxyUrl: ytdlpProxy,
      }),
      "--write-info-json",
      "-o", videoPath,
      url,
    ]);
  } catch (error) {
    throw new Error(describeYtDlpFailure(platform, formatErrorMessage(error)));
  }

  const metadata = await readJsonFile(infoPath);
  return {
    videoPath,
    metadata,
    externalId: sanitizeExternalId(metadata?.id ?? url),
    platform,
    sourceUrl: url,
  };
}

async function downloadYouTubeImportUrl(url, videoPath, infoPath, cookiesPath) {
  const failures = [];

  // Same provider order as downloadYouTubeWithPreferredFallback. Each failure is
  // recorded so the final message says which providers were tried and why they
  // failed, instead of surfacing only the last (yt-dlp) stderr.
  const providers = [
    { name: "HuntAPI", enabled: Boolean(huntApiKey), run: downloadYouTubeWithHuntApi, normalize: normalizeHuntApiYouTubeCandidate },
    { name: "WebAPI", enabled: Boolean(webApiYouTubeApiKey), run: downloadYouTubeWithWebApi, normalize: normalizeWebApiYouTubeCandidate },
    { name: "SaveNow", enabled: Boolean(saveNowApiKey), run: downloadYouTubeWithSaveNow, normalize: normalizeSaveNowYouTubeCandidate },
    { name: "Apify", enabled: Boolean(apifyToken), run: downloadYouTubeWithApify, normalize: normalizeApifyYouTubeCandidate },
  ];

  for (const provider of providers) {
    if (!provider.enabled) {
      failures.push(`${provider.name}: not configured`);
      continue;
    }

    try {
      const item = await provider.run(url, videoPath);
      const candidate = provider.normalize(item, url);
      return {
        videoPath,
        metadata: candidate.metadata,
        externalId: sanitizeExternalId(candidate.externalId ?? url),
        platform: candidate.platform,
        sourceUrl: candidate.sourceUrl,
      };
    } catch (error) {
      const message = formatErrorMessage(error);
      failures.push(`${provider.name}: ${message}`);
      console.warn(`${provider.name} YouTube import failed, falling back: ${message}`);
    }
  }

  try {
    await runCommand("yt-dlp", [
      ...createYtDlpDownloadArgs({
        cookiesPath,
        nodePath: ytdlpNodePath,
        proxyUrl: ytdlpProxy,
      }),
      "--write-info-json",
      "-o", videoPath,
      url,
    ]);
  } catch (error) {
    failures.push(describeYtDlpFailure("youtube", formatErrorMessage(error)));
    throw new Error(`All YouTube download providers failed. ${failures.join(" | ")}`);
  }

  const metadata = await readJsonFile(infoPath);
  return {
    videoPath,
    metadata,
    externalId: sanitizeExternalId(metadata?.id ?? url),
    platform: "youtube",
    sourceUrl: url,
  };
}

async function downloadYouTubeWithHuntApi(url, videoPath) {
  const item = await runHuntApiYouTubeDownloader({
    apiKey: huntApiKey,
    downloadType: huntApiDownloadType,
    endpoint: huntApiVideoDownloadEndpoint,
    maxDuration: huntApiMaxDuration,
    pollIntervalMs: huntApiPollIntervalMs,
    sourceUrl: url,
    timeoutSeconds: huntApiTimeoutSeconds,
    videoFormat: huntApiVideoFormat,
    videoQuality: huntApiVideoQuality,
  });
  await downloadHttpFile(item.download_url, videoPath);
  return item;
}

async function downloadYouTubeWithWebApi(url, videoPath) {
  const item = await runWebApiYouTubeDownloader({
    apiKey: webApiYouTubeApiKey,
    authMode: webApiYouTubeAuthMode,
    endpoint: webApiYouTubeEndpoint,
    format: webApiYouTubeFormat,
    sourceUrl: url,
  });
  await downloadHttpFile(item.download_url, videoPath);
  return item;
}

async function downloadYouTubeWithSaveNow(url, videoPath) {
  const item = await runSaveNowYouTubeDownloader({
    apiKey: saveNowApiKey,
    format: saveNowFormat,
    sourceUrl: url,
  });
  await downloadHttpFile(item.download_url, videoPath);
  return item;
}

async function downloadYouTubeWithPreferredFallback({
  clipPath,
  clipUrl,
  cookiesPath,
}) {
  const failures = [];
  const providers = [
    { name: "HuntAPI", enabled: Boolean(huntApiKey), run: downloadYouTubeWithHuntApi },
    { name: "WebAPI", enabled: Boolean(webApiYouTubeApiKey), run: downloadYouTubeWithWebApi },
    { name: "SaveNow", enabled: Boolean(saveNowApiKey), run: downloadYouTubeWithSaveNow },
    { name: "Apify", enabled: Boolean(apifyToken), run: downloadYouTubeWithApify },
  ];

  for (const provider of providers) {
    if (!provider.enabled) {
      // Recorded, not skipped silently: "not configured" is the most common
      // reason the flow ends up on the cookie-dependent yt-dlp fallback.
      failures.push(`${provider.name}: not configured`);
      continue;
    }

    try {
      await provider.run(clipUrl, clipPath);
      return;
    } catch (error) {
      const message = formatErrorMessage(error);
      failures.push(`${provider.name}: ${message}`);
      console.warn(`${provider.name} YouTube download failed, falling back: ${message}`);
    }
  }

  try {
    await runCommand("yt-dlp", createYtDlpArgs({
      clipPath,
      clipUrl,
      cookiesPath,
      nodePath: ytdlpNodePath,
      proxyUrl: ytdlpProxy,
    }));
  } catch (error) {
    failures.push(describeYtDlpFailure("youtube", formatErrorMessage(error)));
    throw new Error(`All YouTube download providers failed. ${failures.join(" | ")}`);
  }
}

async function downloadYouTubeWithApify(url, videoPath) {
  const items = await runApifyYouTubeDownloader({
    actorId: apifyYouTubeDownloaderActorId,
    input: buildYouTubeDownloadInput(url, apifyYouTubeQuality),
    token: apifyToken,
  });
  const item = items.find((candidate) => findApifyYouTubeDownloadUrl(candidate))
    ?? items.find((candidate) => !candidate?.error && candidate?.status !== "failed");
  if (!item) {
    const errorItem = items.find((candidate) => candidate?.error || candidate?.status === "failed");
    throw new Error(errorItem?.error ?? "Apify did not return a YouTube video");
  }

  const downloadUrl = findApifyYouTubeDownloadUrl(item);
  if (!downloadUrl) {
    if (isApifyYouTubeDemoResult(item)) {
      throw new Error(
        "Apify YouTube downloader returned demo output instead of a video. "
        + "Check the actor subscription/permissions for APIFY_YOUTUBE_DOWNLOADER_ACTOR_ID.",
      );
    }
    const status = item?.status ? ` status=${item.status}` : "";
    const keys = item && typeof item === "object" ? Object.keys(item).join(",") : "none";
    throw new Error(`Apify did not return a downloadable YouTube video URL.${status} keys=${keys}`);
  }

  await downloadHttpFile(downloadUrl, videoPath, {
    token: isApifyApiUrl(downloadUrl) ? apifyToken : undefined,
  });
  return item;
}

function isApifyApiUrl(value) {
  try {
    const url = new URL(value);
    return url.hostname === "api.apify.com";
  } catch {
    return false;
  }
}

function formatErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function downloadTikTokImportUrl(url, videoPath) {
  const items = await runApifyTikTokActor({
    actorId: apifyTikTokActorId,
    input: buildTikTokDownloadInput(url),
    limit: 1,
    token: apifyToken,
  });
  const item = items.find((candidate) => !candidate?.errorCode);
  if (!item) {
    const errorItem = items.find((candidate) => candidate?.errorCode);
    throw new Error(errorItem?.error ?? "Apify did not return a TikTok video");
  }

  const downloadUrl = findApifyTikTokVideoDownloadUrl(item);
  if (!downloadUrl) {
    throw new Error("Apify did not return a downloadable TikTok video URL");
  }

  await downloadHttpFile(downloadUrl, videoPath);
  const candidate = normalizeApifyTikTokVideoCandidate(item, url);
  return {
    videoPath,
    metadata: candidate.metadata,
    externalId: sanitizeExternalId(candidate.externalId ?? url),
    platform: candidate.platform,
    sourceUrl: candidate.sourceUrl,
  };
}

async function downloadInstagramProfile(mediaImport, workdir) {
  const destination = join(workdir, "instagram");
  const cookiesPath = await writeInstagramCookiesFile(workdir);
  if (!cookiesPath) {
    throw new Error("INSTAGRAM_COOKIES_BASE64 is not configured");
  }

  await runCommand("gallery-dl", createGalleryDlArgs({
    cookiesPath,
    destination,
    delaySeconds: instagramDownloadDelaySeconds,
    limit: mediaImport.requested_limit,
    username: mediaImport.input,
  }));

  const files = await listFiles(destination);
  const candidates = await Promise.all(
    files
      .filter((path) => /\.(mp4|mov|webm)$/i.test(path))
      .slice(0, mediaImport.requested_limit)
      .map(async (videoPath) => {
        const metadata = await readJsonFile(`${videoPath}.json`);
        const filename = videoPath.split("/").pop() ?? crypto.randomUUID();
        return {
          videoPath,
          metadata,
          externalId: sanitizeExternalId(metadata?.shortcode ?? metadata?.id ?? filename),
          platform: "instagram",
          sourceUrl: metadata?.post_url ?? metadata?.url ?? null,
        };
      }),
  );
  if (candidates.length === 0) {
    throw new Error("No accessible Instagram Reels were found for this profile");
  }
  return candidates;
}

async function storeImportedVideo(mediaImport, candidate, workdir) {
  const storageId = candidate.externalId || crypto.randomUUID();
  const videoStoragePath = `${mediaImport.user_id}/${storageId}.mp4`;
  const thumbnailStoragePath = `${mediaImport.user_id}/${storageId}.jpg`;
  const thumbnailPath = join(workdir, `${storageId}.jpg`);

  await runCommand("ffmpeg", [
    "-y", "-i", candidate.videoPath, "-frames:v", "1", "-q:v", "3", thumbnailPath,
  ]);

  await uploadStorageFile("source-videos", videoStoragePath, candidate.videoPath, "video/mp4");
  await uploadStorageFile(
    "source-thumbnails",
    thumbnailStoragePath,
    thumbnailPath,
    "image/jpeg",
  );

  const metadata = candidate.metadata ?? {};
  const row = {
    user_id: mediaImport.user_id,
    avatar_id: mediaImport.avatar_id,
    name: String(metadata.title ?? metadata.description ?? storageId).slice(0, 240),
    storage_path: videoStoragePath,
    duration_s: numberOrNull(metadata.duration),
    source_type: mediaImport.type,
    source_url: candidate.sourceUrl,
    source_platform: candidate.platform,
    source_external_id: storageId,
    source_username: mediaImport.type === "instagram_profile" ? mediaImport.input : null,
    thumbnail_path: thumbnailStoragePath,
    source_published_at: metadata.timestamp
      ? new Date(Number(metadata.timestamp) * 1000).toISOString()
      : null,
    view_count: numberOrNull(metadata.view_count),
    like_count: numberOrNull(metadata.like_count),
    metadata,
  };
  const { data: existing } = await supabase
    .from("source_videos")
    .select("id")
    .eq("user_id", mediaImport.user_id)
    .eq("source_platform", candidate.platform)
    .eq("source_external_id", storageId)
    .maybeSingle();
  // `select("id").single()` nos dois caminhos: o id volta para processMediaImport gravar
  // em media_imports.source_video_ids, e é isso que faz o frontend parar de adivinhar
  // qual vídeo foi criado.
  const query = existing
    ? supabase.from("source_videos").update(row).eq("id", existing.id).select("id").single()
    : supabase.from("source_videos").insert(row).select("id").single();
  const { data, error } = await query;
  if (error) throw error;
  return data.id;
}

async function uploadStorageFile(bucket, storagePath, localPath, contentType) {
  if (storageBackend === "r2") {
    await r2UploadFile(`${bucket}/${storagePath}`, localPath, contentType);
    return;
  }
  // openAsBlob dá um Blob lastreado no arquivo — o conteúdo só é lido conforme sobe,
  // em vez de readFile trazer o MP4 inteiro pra memória antes do upload.
  const upload = await supabase.storage
    .from(bucket)
    .upload(storagePath, await openAsBlob(localPath, { type: contentType }), {
      contentType,
      upsert: true,
    });
  if (upload.error) throw upload.error;
}

async function downloadHttpFile(url, outputPath, options = {}) {
  const headers = options.token ? { Authorization: `Bearer ${options.token}` } : undefined;
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Failed to download media: ${response.status} ${response.statusText}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(outputPath));
}

async function updateMediaImport(importId, values) {
  const { error } = await supabase.from("media_imports").update(values).eq("id", importId);
  if (error) throw error;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function writeInstagramCookiesFile(workdir) {
  if (!instagramCookiesBase64) return undefined;
  const path = join(workdir, "instagram-cookies.txt");
  await writeFile(path, Buffer.from(normalizeBase64Env(instagramCookiesBase64), "base64"), { mode: 0o600 });
  return path;
}

async function listFiles(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = join(path, entry.name);
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
  }));
  return nested.flat();
}

async function readJsonFile(path) {
  try {
    if (!(await stat(path)).isFile()) return null;
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function updateJob(jobId, values) {
  const { error } = await supabase.from("reel_jobs").update(values).eq("id", jobId);
  if (error) throw error;
}

async function hydrateSourceVideo(job) {
  if (job.source_videos?.storage_path) return;

  const sourceVideoId = job.source_video_id ?? getSourceVideoIdFromClipUrl(job.clip_url);
  if (!sourceVideoId) return;

  const { data, error } = await supabase
    .from("source_videos")
    .select("storage_path")
    .eq("id", sourceVideoId)
    .eq("user_id", job.user_id)
    .single();

  if (error || !data) {
    throw new Error("Source video not found");
  }

  job.source_videos = data;
}

async function downloadStorageFile(bucket, storagePath, outputPath) {
  if (storageBackend === "r2") {
    await r2DownloadFile(`${bucket}/${storagePath}`, outputPath);
    return;
  }
  const { data, error } = await supabase.storage.from(bucket).download(storagePath);
  if (error || !data) {
    throw new Error(`Failed to download ${bucket} file`);
  }
  await pipeline(Readable.fromWeb(data.stream()), createWriteStream(outputPath));
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(options.captureStdout ? stdout : undefined);
      } else {
        reject(new Error(stderr || `${command} exited with code ${code}`));
      }
    });
  });
}

async function runFfmpegWithDrawTextFallback({
  clipPath,
  outputPath,
  overlayText,
  reactionPositionX,
  reactionPositionY,
  reactionPath,
}) {
  try {
    await runCommand("ffmpeg", createFfmpegArgs({
      clipPath,
      outputPath,
      overlayText,
      reactionPositionX,
      reactionPositionY,
      reactionPath,
      withDrawText: true,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!message.includes("No such filter: 'drawtext'")) {
      throw error;
    }

    await runCommand("ffmpeg", createFfmpegArgs({
      clipPath,
      outputPath,
      overlayText,
      reactionPositionX,
      reactionPositionY,
      reactionPath,
      withDrawText: false,
    }));
  }
}

function clampLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 12;
  return Math.max(1, Math.min(20, Math.trunc(parsed)));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

// yt-dlp hands the whole cookie jar to whatever host it contacts, so a jar is
// only ever written for the platform it belongs to.
async function writeCookiesForPlatform(platform, workdir) {
  if (platform === "youtube") return writeYoutubeCookiesFile(workdir);
  if (platform === "instagram") return writeInstagramCookiesFile(workdir);
  return undefined;
}

async function writeYoutubeCookiesFile(workdir) {
  const { content: cookieContent } = await readYoutubeCookieContent();

  if (!cookieContent) {
    return undefined;
  }

  const cookiesPath = join(workdir, "youtube-cookies.txt");
  await writeFile(cookiesPath, cookieContent.trimEnd() + "\n", { mode: 0o600 });
  return cookiesPath;
}

// Answers "is this deploy actually able to download?" in one request: which
// providers are wired up, whether the YouTube session is still alive, and
// whether yt-dlp can impersonate a browser (required by TikTok). Booleans and
// cookie names only — never a secret or a cookie value.
async function buildHealthPayload() {
  const ytdlp = await inspectYtDlp();
  const { content: cookieContent, source: cookieSource } = await readYoutubeCookieContent();

  return {
    ok: true,
    revision: workerRevision,
    // Responde "este deploy processa dentro da requisicao ou em fila?" -- a primeira
    // duvida ao verificar se a migracao para a Vercel pegou.
    runtime: statelessRuntime ? "vercel-container" : "vps-queue",
    storageBackend: storageBackend || "supabase",
    // Queue depth stays here: it is what tells you the worker is alive but
    // saturated (the 503 "Worker busy" path) rather than broken.
    active: activeJobs,
    queued: jobQueue.length,
    ytdlp,
    providers: {
      huntapi: Boolean(huntApiKey),
      webapi: Boolean(webApiYouTubeApiKey),
      savenow: Boolean(saveNowApiKey),
      apify: Boolean(apifyToken),
      proxy: Boolean(ytdlpProxy),
    },
    cookies: {
      // `source` responde "o worker está lendo o cookie que acabei de salvar, ou ainda o
      // do env?" -- a primeira dúvida depois de migrar.
      youtube: { source: cookieSource, ...summarizeYoutubeCookies(cookieContent, Date.now()) },
      instagram: { present: Boolean(instagramCookiesBase64) },
    },
  };
}

// Cached for the process lifetime: neither the binary nor its build can change
// without a redeploy, and /health may be polled by an uptime check.
let ytdlpInspection;

async function inspectYtDlp() {
  if (ytdlpInspection) return ytdlpInspection;

  const [version, impersonation, jsChallenge] = await Promise.all([
    runCommand("yt-dlp", ["--version"], { captureStdout: true })
      .then((out) => out.trim())
      .catch((error) => `unavailable: ${formatErrorMessage(error)}`),
    runCommand("yt-dlp", ["--list-impersonate-targets"], { captureStdout: true })
      .then((out) => {
        const targets = parseImpersonateTargets(out);
        return { available: targets.length > 0, targetCount: targets.length, sample: targets.slice(0, 3) };
      })
      .catch((error) => ({ available: false, targetCount: 0, error: formatErrorMessage(error) })),
    // O YouTube exige resolver um desafio de JavaScript. Sem o pacote yt-dlp-ejs na
    // imagem, o yt-dlp nao tem o que executar e a resposta vira bot-check -- indistinguivel
    // de cookie vencido para quem le o erro. Foi assim que o YouTube quebrou na migracao
    // para a Vercel, e este campo existe para que a proxima vez seja obvia.
    inspectJsChallengeSupport(),
  ]);

  ytdlpInspection = { version, impersonation, jsChallenge };
  return ytdlpInspection;
}

const YOUTUBE_COOKIE_CREDENTIAL_KEY = "youtube_cookies";

// O banco vem primeiro para que trocar um cookie vencido seja um paste na tela do Avasyn,
// sem recriar o container. As variáveis de ambiente continuam valendo como fallback: a
// migração não quebra um deploy que ainda só tem YOUTUBE_COOKIES_BASE64, e se o Supabase
// estiver fora do ar o download não para por causa disso.
//
// Sem cache de propósito: é um lookup por chave primária, os jobs levam minutos, e cachear
// significaria continuar usando o cookie velho depois de você ter colado o novo.
async function inspectJsChallengeSupport() {
  const nodeAvailable = await runCommand(ytdlpNodePath, ["--version"], { captureStdout: true })
    .then((out) => out.trim())
    .catch(() => null);

  const ejs = await runCommand("python3", ["-c", "import yt_dlp_ejs; print('ok')"], { captureStdout: true })
    .then(() => true)
    .catch(() => false);

  return {
    // Os dois precisam existir: o pacote fornece o codigo, o runtime executa.
    ready: ejs && Boolean(nodeAvailable),
    ejsPackage: ejs,
    jsRuntime: nodeAvailable ? `node ${nodeAvailable}` : `nao encontrado em ${ytdlpNodePath}`,
  };
}

async function readYoutubeCookieContent() {
  const stored = await readStoredYoutubeCookies();
  if (stored) return { content: stored, source: "database" };

  if (youtubeCookiesBase64) {
    try {
      return {
        content: Buffer.from(normalizeBase64Env(youtubeCookiesBase64), "base64").toString("utf8"),
        source: "env:YOUTUBE_COOKIES_BASE64",
      };
    } catch {
      return { content: undefined, source: "env:invalid-base64" };
    }
  }

  if (youtubeCookies) return { content: youtubeCookies, source: "env:YOUTUBE_COOKIES" };

  return { content: undefined, source: "none" };
}

async function readStoredYoutubeCookies() {
  try {
    const { data, error } = await supabase
      .from("worker_credentials")
      .select("value")
      .eq("key", YOUTUBE_COOKIE_CREDENTIAL_KEY)
      .maybeSingle();

    if (error) throw error;
    return data?.value ?? undefined;
  } catch (error) {
    // Nunca deixa a leitura derrubar o job: cair no env é melhor que falhar o download.
    console.warn(
      `Could not read stored YouTube cookies, falling back to env: ${formatErrorMessage(error)}`,
    );
    return undefined;
  }
}

function normalizeBase64Env(value) {
  return value.replace(/\s+/g, "");
}
