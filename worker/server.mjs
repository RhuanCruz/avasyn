import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { r2UploadFile, r2DownloadFile } from "./r2.mjs";

import { createClient } from "@supabase/supabase-js";

import { createFfmpegArgs } from "./ffmpeg-options.mjs";
import { getClipSource, getSourceVideoIdFromClipUrl } from "./job-media.mjs";
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
  createGalleryDlArgs,
  detectPlatform,
  sanitizeExternalId,
} from "./media-import.mjs";
import { parseTikTokSearchOutput } from "./tiktok-search.mjs";
import { createTikTokSearchArgs, createYtDlpArgs } from "./ytdlp-options.mjs";

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
const workerRevision = process.env.AVASYN_WORKER_REVISION ?? "local";
const instagramDownloadDelaySeconds = Number(
  process.env.INSTAGRAM_DOWNLOAD_DELAY_SECONDS ?? 2,
);

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") {
      return sendJson(response, 200, { ok: true, revision: workerRevision });
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

    await processJob(String(body.jobId));
    return sendJson(response, 200, { ok: true, jobId: body.jobId });
  } catch (error) {
    console.error(error);
    return sendJson(response, 500, {
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}).listen(port, () => {
  console.log(`Avasyn video worker listening on ${port}`);
});

async function processJob(jobId) {
  const job = await findJob(jobId);
  await hydrateSourceVideo(job);

  await updateJob(jobId, { status: "processing", error_message: null });

  const workdir = await mkdtemp(join(tmpdir(), "avasyn-"));
  const clipPath = join(workdir, "clip.mp4");
  const reactionPath = join(workdir, "reaction.mp4");
  const outputPath = join(workdir, "output.mp4");

  try {
    const cookiesPath = await writeYoutubeCookiesFile(workdir);
    const clipSource = getClipSource(job);

    if (clipSource.type === "storage") {
      await downloadStorageFile("source-videos", clipSource.path, clipPath);
    } else if (detectPlatform(clipSource.url) === "youtube") {
      await downloadYouTubeWithPreferredFallback({
        clipPath,
        clipUrl: clipSource.url,
        cookiesPath,
      });
    } else {
      await runCommand("yt-dlp", createYtDlpArgs({
        clipPath,
        clipUrl: clipSource.url,
        cookiesPath,
        nodePath: ytdlpNodePath,
        proxyUrl: ytdlpProxy,
      }));
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
    const cookiesPath = await writeYoutubeCookiesFile(workdir);
    const output = await runCommand("yt-dlp", createTikTokSearchArgs({
      query,
      limit,
      cookiesPath,
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

    for (const candidate of candidates) {
      await storeImportedVideo(mediaImport, candidate, workdir);
      processed += 1;
      await updateMediaImport(importId, { processed_items: processed });
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

async function downloadImportUrl(url, workdir) {
  const videoPath = join(workdir, "import.mp4");
  const infoPath = join(workdir, "import.info.json");
  const platform = detectPlatform(url);
  if (platform === "tiktok" && apifyToken) {
    return downloadTikTokImportUrl(url, videoPath);
  }
  if (platform === "youtube") {
    const cookiesPath = await writeYoutubeCookiesFile(workdir);
    return downloadYouTubeImportUrl(url, videoPath, infoPath, cookiesPath);
  }

  const cookiesPath = platform === "instagram"
    ? await writeInstagramCookiesFile(workdir)
    : await writeYoutubeCookiesFile(workdir);
  await runCommand("yt-dlp", [
    "-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best",
    "--merge-output-format", "mp4",
    "--max-filesize", "300M",
    "--js-runtimes", `node:${ytdlpNodePath}`,
    "--no-playlist",
    "--write-info-json",
    ...(cookiesPath ? ["--cookies", cookiesPath] : []),
    ...(ytdlpProxy ? ["--proxy", ytdlpProxy] : []),
    "-o", videoPath,
    url,
  ]);

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
  if (saveNowApiKey) {
    try {
      const item = await downloadYouTubeWithSaveNow(url, videoPath);
      const candidate = normalizeSaveNowYouTubeCandidate(item, url);
      return {
        videoPath,
        metadata: candidate.metadata,
        externalId: sanitizeExternalId(candidate.externalId ?? url),
        platform: candidate.platform,
        sourceUrl: candidate.sourceUrl,
      };
    } catch (error) {
      console.warn(`SaveNow YouTube import failed, falling back: ${formatErrorMessage(error)}`);
    }
  }

  if (apifyToken) {
    try {
      const item = await downloadYouTubeWithApify(url, videoPath);
      const candidate = normalizeApifyYouTubeCandidate(item, url);
      return {
        videoPath,
        metadata: candidate.metadata,
        externalId: sanitizeExternalId(candidate.externalId ?? url),
        platform: candidate.platform,
        sourceUrl: candidate.sourceUrl,
      };
    } catch (error) {
      console.warn(`Apify YouTube import failed, falling back to yt-dlp: ${formatErrorMessage(error)}`);
    }
  }

  await runCommand("yt-dlp", [
    "-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best",
    "--merge-output-format", "mp4",
    "--max-filesize", "300M",
    "--js-runtimes", `node:${ytdlpNodePath}`,
    "--no-playlist",
    "--write-info-json",
    ...(cookiesPath ? ["--cookies", cookiesPath] : []),
    ...(ytdlpProxy ? ["--proxy", ytdlpProxy] : []),
    "-o", videoPath,
    url,
  ]);

  const metadata = await readJsonFile(infoPath);
  return {
    videoPath,
    metadata,
    externalId: sanitizeExternalId(metadata?.id ?? url),
    platform: "youtube",
    sourceUrl: url,
  };
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

  if (saveNowApiKey) {
    try {
      await downloadYouTubeWithSaveNow(clipUrl, clipPath);
      return;
    } catch (error) {
      const message = formatErrorMessage(error);
      failures.push(`SaveNow: ${message}`);
      console.warn(`SaveNow YouTube download failed, falling back: ${message}`);
    }
  }

  try {
    if (apifyToken) {
      await downloadYouTubeWithApify(clipUrl, clipPath);
      return;
    }
  } catch (error) {
    const message = formatErrorMessage(error);
    failures.push(`Apify: ${message}`);
    console.warn(`Apify YouTube download failed, falling back to yt-dlp: ${message}`);
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
    failures.push(`yt-dlp: ${formatErrorMessage(error)}`);
    throw new Error(
      "All YouTube download providers failed. "
      + "SaveNow/Apify did not provide a usable MP4 before yt-dlp fallback was blocked. "
      + failures.join(" | "),
    );
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
  const query = existing
    ? supabase.from("source_videos").update(row).eq("id", existing.id)
    : supabase.from("source_videos").insert(row);
  const { error } = await query;
  if (error) throw error;
}

async function uploadStorageFile(bucket, storagePath, localPath, contentType) {
  if (storageBackend === "r2") {
    await r2UploadFile(`${bucket}/${storagePath}`, localPath, contentType);
    return;
  }
  const upload = await supabase.storage
    .from(bucket)
    .upload(storagePath, await readFile(localPath), { contentType, upsert: true });
  if (upload.error) throw upload.error;
}

async function downloadHttpFile(url, outputPath, options = {}) {
  const headers = options.token ? { Authorization: `Bearer ${options.token}` } : undefined;
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Failed to download media: ${response.status} ${response.statusText}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(outputPath, buffer);
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
  await writeFile(outputPath, Buffer.from(await data.arrayBuffer()));
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

async function writeYoutubeCookiesFile(workdir) {
  const cookieContent = youtubeCookiesBase64
    ? Buffer.from(normalizeBase64Env(youtubeCookiesBase64), "base64").toString("utf8")
    : youtubeCookies;

  if (!cookieContent) {
    return undefined;
  }

  const cookiesPath = join(workdir, "youtube-cookies.txt");
  await writeFile(cookiesPath, cookieContent.trimEnd() + "\n", { mode: 0o600 });
  return cookiesPath;
}

function normalizeBase64Env(value) {
  return value.replace(/\s+/g, "");
}
