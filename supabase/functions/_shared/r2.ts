// SigV4 presigner for Cloudflare R2 (S3-compatible). No SDK — uses Web Crypto API.

const REGION = "auto";
const SERVICE = "s3";

interface R2Config {
  host: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

function getConfig(): R2Config {
  const accountId = Deno.env.get("R2_ACCOUNT_ID");
  const bucket = Deno.env.get("R2_BUCKET");
  const accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID");
  const secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY");
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

async function hmacSha256(key: ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
}

async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return toHex(digest);
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function buildSigningKey(secretKey: string, dateStr: string): Promise<ArrayBuffer> {
  const k1 = await hmacSha256(new TextEncoder().encode(`AWS4${secretKey}`).buffer as ArrayBuffer, dateStr);
  const k2 = await hmacSha256(k1, REGION);
  const k3 = await hmacSha256(k2, SERVICE);
  return hmacSha256(k3, "aws4_request");
}

// RFC 3986 strict encoding: encodeURIComponent leaves !'()* unencoded, but
// S3/R2 SigV4 requires them percent-encoded or the signature won't match.
function rfc3986(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

// Encode each URL path segment individually, preserving slashes.
function encodeUriPath(path: string): string {
  return path.split("/").map(rfc3986).join("/");
}

async function presign(method: string, key: string, expiresSeconds: number): Promise<string> {
  const { host, bucket, accessKeyId, secretAccessKey } = getConfig();

  const now = new Date();
  const datetime = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const date = datetime.slice(0, 8);

  const credentialScope = `${date}/${REGION}/${SERVICE}/aws4_request`;

  const queryParams: Record<string, string> = {
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
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = await buildSigningKey(secretAccessKey, date);
  const signature = toHex(await hmacSha256(signingKey, stringToSign));

  return `https://${host}/${encodeUriPath(bucket)}/${encodeUriPath(key)}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}

export function r2PresignGet(key: string, expiresSeconds = 7200): Promise<string> {
  return presign("GET", key, expiresSeconds);
}

export function r2PresignPut(key: string, expiresSeconds = 900): Promise<string> {
  return presign("PUT", key, expiresSeconds);
}

export function r2PresignDelete(key: string, expiresSeconds = 300): Promise<string> {
  return presign("DELETE", key, expiresSeconds);
}

export async function r2Download(key: string): Promise<ArrayBuffer> {
  const url = await presign("GET", key, 300);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`R2 download failed: ${response.status} ${response.statusText} (key=${key})`);
  }
  return response.arrayBuffer();
}
