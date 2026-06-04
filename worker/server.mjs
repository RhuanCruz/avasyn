import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";

import { getClipSource } from "./job-media.mjs";
import { parseTikTokSearchOutput } from "./tiktok-search.mjs";
import { createTikTokSearchArgs, createYtDlpArgs } from "./ytdlp-options.mjs";

const port = Number(process.env.PORT ?? 8080);
const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const workerSecret = process.env.VIDEO_WORKER_SECRET;
const ytdlpNodePath = process.env.YTDLP_NODE_PATH ?? "/usr/local/bin/node";
const ytdlpProxy = process.env.YTDLP_PROXY;
const youtubeCookiesBase64 = process.env.YOUTUBE_COOKIES_BASE64;
const youtubeCookies = process.env.YOUTUBE_COOKIES;

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
      return sendJson(response, 200, { ok: true });
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
  const { data: job, error } = await supabase
    .from("reel_jobs")
    .select("*, reaction_videos(storage_path), source_videos(storage_path)")
    .eq("id", jobId)
    .single();

  if (error || !job) throw new Error("Job not found");

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
    } else {
      await runCommand("yt-dlp", createYtDlpArgs({
        clipPath,
        clipUrl: clipSource.url,
        cookiesPath,
        nodePath: ytdlpNodePath,
        proxyUrl: ytdlpProxy,
      }));
    }

    await downloadStorageFile("reaction-videos", job.reaction_videos.storage_path, reactionPath);

    await runCommand("ffmpeg", [
      "-y",
      "-i",
      reactionPath,
      "-i",
      clipPath,
      "-filter_complex",
      `[0:v]scale=720:640,setsar=1[top];[1:v]scale=720:640,setsar=1[bot];[top][bot]vstack=inputs=2[stack];[stack]drawtext=text='${escapeDrawText(
        job.overlay_text,
      )}':fontsize=28:fontcolor=white:x=(w-text_w)/2:y=636:box=1:boxcolor=black@0.5:borderw=8[out]`,
      "-map",
      "[out]",
      "-map",
      "0:a?",
      "-t",
      "90",
      "-r",
      "30",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      outputPath,
    ]);

    const storagePath = `${job.user_id}/${job.id}.mp4`;
    const upload = await supabase.storage
      .from("generated-reels")
      .upload(storagePath, await readFile(outputPath), {
        contentType: "video/mp4",
        upsert: true,
      });
    if (upload.error) throw upload.error;

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

async function searchTikTok(query, limit) {
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

async function updateJob(jobId, values) {
  const { error } = await supabase.from("reel_jobs").update(values).eq("id", jobId);
  if (error) throw error;
}

async function downloadStorageFile(bucket, storagePath, outputPath) {
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
    ? Buffer.from(youtubeCookiesBase64, "base64").toString("utf8")
    : youtubeCookies;

  if (!cookieContent) {
    return undefined;
  }

  const cookiesPath = join(workdir, "youtube-cookies.txt");
  await writeFile(cookiesPath, cookieContent.trimEnd() + "\n", { mode: 0o600 });
  return cookiesPath;
}

function escapeDrawText(value) {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "\\'")
    .replaceAll(":", "\\:");
}
