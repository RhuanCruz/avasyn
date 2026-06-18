#!/usr/bin/env node
// One-off script to copy all existing media objects from Supabase Storage to
// Cloudflare R2. The R2 migration (STORAGE_BACKEND=r2) only flipped the backend
// for new uploads — it never copied pre-existing files. This completes the move
// so signed R2 URLs resolve and old previews work again.
//
// Safe + idempotent: only reads from Supabase and writes to R2 (PUT = upsert).
// It never deletes anything. Run scripts/purge-storage.mjs separately, AFTER
// verifying previews, to free the old Supabase objects.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//   R2_ACCOUNT_ID=... R2_BUCKET=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
//   node scripts/copy-supabase-to-r2.mjs               # all buckets
//   node scripts/copy-supabase-to-r2.mjs source-videos # one bucket
//   node scripts/copy-supabase-to-r2.mjs --dry-run     # list only, no copy

import { createHmac, createHash } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_BUCKET = process.env.R2_BUCKET;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
if (!R2_ACCOUNT_ID || !R2_BUCKET || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
  console.error("Set R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.");
  process.exit(1);
}

const ALL_BUCKETS = ["generated-reels", "source-videos", "reaction-videos", "source-thumbnails"];

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const bucketArg = args.find((a) => !a.startsWith("--"));
const targetBuckets = bucketArg ? [bucketArg] : ALL_BUCKETS;

const supabaseHeaders = {
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
  apikey: SERVICE_ROLE_KEY,
};

// ---------------------------------------------------------------------------
// Supabase Storage REST: recursive listing + download
// ---------------------------------------------------------------------------

async function listPage(bucket, prefix, limit, offset) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${bucket}`, {
    method: "POST",
    headers: supabaseHeaders,
    body: JSON.stringify({ prefix, limit, offset, sortBy: { column: "name", order: "asc" } }),
  });
  if (!res.ok) throw new Error(`list failed (${bucket} "${prefix}"): ${res.status} ${await res.text()}`);
  return res.json();
}

// Objects are nested under `${user_id}/...`, so listing prefix="" returns
// folders (metadata === null). Recurse into folders, collect files.
async function listAllFiles(bucket, prefix = "") {
  const files = [];
  const batchSize = 100;
  let offset = 0;

  while (true) {
    const items = await listPage(bucket, prefix, batchSize, offset);
    if (!items || items.length === 0) break;

    for (const item of items) {
      const fullPath = prefix ? `${prefix}${item.name}` : item.name;
      if (item.metadata === null || item.id === null) {
        // Folder — recurse into it.
        const nested = await listAllFiles(bucket, `${fullPath}/`);
        files.push(...nested);
      } else {
        files.push({ path: fullPath, mimetype: item.metadata?.mimetype ?? null });
      }
    }

    if (items.length < batchSize) break;
    offset += batchSize;
  }

  return files;
}

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function downloadFromSupabase(bucket, path) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${encodePath(path)}`, {
    headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}`, apikey: SERVICE_ROLE_KEY },
  });
  if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText}`);
  const contentType = res.headers.get("content-type");
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType };
}

// ---------------------------------------------------------------------------
// R2 SigV4 presigner (mirrors worker/r2.mjs)
// ---------------------------------------------------------------------------

const REGION = "auto";
const SERVICE = "s3";
const R2_HOST = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

function hmac(key, data) {
  return createHmac("sha256", key).update(data).digest();
}
function sha256hex(data) {
  return createHash("sha256").update(data).digest("hex");
}
function buildSigningKey(secretKey, dateStr) {
  const k1 = hmac(Buffer.from(`AWS4${secretKey}`), dateStr);
  const k2 = hmac(k1, REGION);
  const k3 = hmac(k2, SERVICE);
  return hmac(k3, "aws4_request");
}
function encodeUriPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function presign(method, key, expiresSeconds) {
  const now = new Date();
  const datetime = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const date = datetime.slice(0, 8);
  const credentialScope = `${date}/${REGION}/${SERVICE}/aws4_request`;

  const queryParams = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${R2_ACCESS_KEY_ID}/${credentialScope}`,
    "X-Amz-Date": datetime,
    "X-Amz-Expires": String(expiresSeconds),
    "X-Amz-SignedHeaders": "host",
  };

  const canonicalQueryString = Object.keys(queryParams)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`)
    .join("&");

  const canonicalUri = `/${encodeUriPath(R2_BUCKET)}/${encodeUriPath(key)}`;
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    `host:${R2_HOST}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    datetime,
    credentialScope,
    sha256hex(canonicalRequest),
  ].join("\n");

  const signingKey = buildSigningKey(R2_SECRET_ACCESS_KEY, date);
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  return `https://${R2_HOST}/${R2_BUCKET}/${key}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}

async function uploadToR2(key, buffer, contentType) {
  const url = presign("PUT", key, 900);
  const res = await fetch(url, {
    method: "PUT",
    body: buffer,
    headers: { "Content-Type": contentType },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`R2 upload failed: ${res.status} ${res.statusText} (key=${key}) ${text}`);
  }
}

// ---------------------------------------------------------------------------
// Content-Type resolution
// ---------------------------------------------------------------------------

const EXT_TYPES = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

function resolveContentType(path, listMime, downloadMime) {
  if (listMime && listMime !== "application/octet-stream") return listMime;
  if (downloadMime && downloadMime !== "application/octet-stream") return downloadMime;
  const ext = path.split(".").pop()?.toLowerCase();
  return EXT_TYPES[ext] ?? "application/octet-stream";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function copyBucket(bucket) {
  console.log(`\nBucket: ${bucket}`);
  const files = await listAllFiles(bucket);
  console.log(`  Found ${files.length} file(s).`);

  if (DRY_RUN) {
    for (const f of files.slice(0, 10)) console.log(`    [dry] ${f.path} (${f.mimetype ?? "?"})`);
    if (files.length > 10) console.log(`    ... +${files.length - 10} more`);
    return { copied: 0, failed: 0, total: files.length };
  }

  let copied = 0;
  let failed = 0;
  const concurrency = 4;

  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (file) => {
        try {
          const { buffer, contentType: dlType } = await downloadFromSupabase(bucket, file.path);
          const ct = resolveContentType(file.path, file.mimetype, dlType);
          await uploadToR2(`${bucket}/${file.path}`, buffer, ct);
          copied += 1;
        } catch (err) {
          failed += 1;
          console.error(`  FAIL ${file.path}: ${err.message}`);
        }
      }),
    );
    console.log(`  Progress: ${Math.min(i + concurrency, files.length)}/${files.length} (copied ${copied}, failed ${failed})`);
  }

  console.log(`  Done — copied ${copied}, failed ${failed} of ${files.length}`);
  return { copied, failed, total: files.length };
}

async function main() {
  console.log(DRY_RUN ? "DRY RUN — listing only, no copy." : "Copying Supabase Storage → R2...");
  const summary = [];
  for (const bucket of targetBuckets) {
    try {
      const result = await copyBucket(bucket);
      summary.push({ bucket, ...result });
    } catch (err) {
      console.error(`Error on bucket ${bucket}:`, err.message);
      summary.push({ bucket, copied: 0, failed: -1, total: -1 });
    }
  }

  console.log("\n=== Summary ===");
  for (const s of summary) {
    console.log(`  ${s.bucket}: ${s.copied} copied, ${s.failed} failed (of ${s.total})`);
  }
  const anyFail = summary.some((s) => s.failed !== 0);
  console.log(anyFail ? "\nCompleted with failures — review logs above." : "\nAll objects copied successfully.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
