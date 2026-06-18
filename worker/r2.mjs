// SigV4 presigner for Cloudflare R2 (S3-compatible). No SDK — uses node:crypto.
import { createHmac, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const REGION = "auto";
const SERVICE = "s3";

function getConfig() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const bucket = process.env.R2_BUCKET;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "Missing R2 environment variables: R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY",
    );
  }
  return {
    host: `${accountId}.r2.cloudflarestorage.com`,
    bucket,
    accessKeyId,
    secretAccessKey,
  };
}

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

// RFC 3986 strict encoding: encodeURIComponent leaves !'()* unencoded, but
// S3/R2 SigV4 requires them percent-encoded or the signature won't match.
function rfc3986(segment) {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
function encodeUriPath(path) {
  return path.split("/").map(rfc3986).join("/");
}

function presign(method, key, expiresSeconds) {
  const { host, bucket, accessKeyId, secretAccessKey } = getConfig();

  const now = new Date();
  const datetime = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const date = datetime.slice(0, 8);

  const credentialScope = `${date}/${REGION}/${SERVICE}/aws4_request`;

  const queryParams = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${accessKeyId}/${credentialScope}`,
    "X-Amz-Date": datetime,
    "X-Amz-Expires": String(expiresSeconds),
    "X-Amz-SignedHeaders": "host",
  };

  const canonicalQueryString = Object.keys(queryParams)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`)
    .join("&");

  const canonicalUri = `/${encodeUriPath(bucket)}/${encodeUriPath(key)}`;

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    `host:${host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    datetime,
    credentialScope,
    sha256hex(canonicalRequest),
  ].join("\n");

  const signingKey = buildSigningKey(secretAccessKey, date);
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  return `https://${host}/${encodeUriPath(bucket)}/${encodeUriPath(key)}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}

export async function r2UploadFile(key, localPath, contentType) {
  const url = presign("PUT", key, 900);
  const body = await readFile(localPath);
  const response = await fetch(url, {
    method: "PUT",
    body,
    headers: { "Content-Type": contentType },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`R2 upload failed: ${response.status} ${response.statusText} (key=${key}) ${text}`);
  }
}

export async function r2DownloadFile(key, outputPath) {
  const url = presign("GET", key, 300);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`R2 download failed: ${response.status} ${response.statusText} (key=${key})`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(outputPath, buffer);
}
