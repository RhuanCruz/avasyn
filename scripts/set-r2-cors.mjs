#!/usr/bin/env node
// One-off script to set the CORS policy on the R2 bucket so the browser can
// PUT directly to presigned upload URLs (library/reactions upload). R2 buckets
// have no CORS by default, so the cross-origin PUT preflight is blocked and the
// app shows "NetworkError when attempting to fetch resource".
//
// Uses the S3 PutBucketCors operation, SigV4-signed with an Authorization
// header (not a presigned URL, since this request has a body + ?cors
// subresource). No SDK.
//
// Usage:
//   R2_ACCOUNT_ID=... R2_BUCKET=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
//   node scripts/set-r2-cors.mjs
//
//   # restrict origins instead of "*":
//   R2_ALLOWED_ORIGINS="https://app.exemplo.com,http://localhost:5173" node scripts/set-r2-cors.mjs

import { createHmac, createHash } from "node:crypto";

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_BUCKET = process.env.R2_BUCKET;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;

if (!R2_ACCOUNT_ID || !R2_BUCKET || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
  console.error("Set R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.");
  process.exit(1);
}

const REGION = "auto";
const SERVICE = "s3";
const HOST = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

const origins = (process.env.R2_ALLOWED_ORIGINS ?? "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const METHODS = ["GET", "PUT", "HEAD"];

function buildCorsXml() {
  const originXml = origins.map((o) => `<AllowedOrigin>${o}</AllowedOrigin>`).join("");
  const methodXml = METHODS.map((m) => `<AllowedMethod>${m}</AllowedMethod>`).join("");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<CORSConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">` +
    `<CORSRule>` +
    originXml +
    methodXml +
    `<AllowedHeader>*</AllowedHeader>` +
    `<ExposeHeader>ETag</ExposeHeader>` +
    `<MaxAgeSeconds>3600</MaxAgeSeconds>` +
    `</CORSRule>` +
    `</CORSConfiguration>`
  );
}

// ---------------------------------------------------------------------------
// SigV4 (Authorization header variant, signed payload)
// ---------------------------------------------------------------------------

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

async function putBucketCors() {
  const body = Buffer.from(buildCorsXml(), "utf8");
  const payloadHash = sha256hex(body);
  const contentMd5 = createHash("md5").update(body).digest("base64");

  const now = new Date();
  const datetime = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const date = datetime.slice(0, 8);
  const credentialScope = `${date}/${REGION}/${SERVICE}/aws4_request`;

  const canonicalUri = `/${R2_BUCKET}`;
  const canonicalQueryString = "cors=";

  // Header names must be lowercase and sorted in the canonical headers block.
  const headers = {
    "content-md5": contentMd5,
    host: HOST,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": datetime,
  };
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((k) => `${k}:${headers[k]}\n`)
    .join("");

  const canonicalRequest = [
    "PUT",
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    datetime,
    credentialScope,
    sha256hex(canonicalRequest),
  ].join("\n");

  const signingKey = buildSigningKey(R2_SECRET_ACCESS_KEY, date);
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${R2_ACCESS_KEY_ID}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const url = `https://${HOST}${canonicalUri}?cors`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: authorization,
      "Content-MD5": contentMd5,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": datetime,
      "Content-Type": "application/xml",
    },
    body,
  });

  const text = await res.text().catch(() => "");
  return { status: res.status, ok: res.ok, text };
}

async function main() {
  console.log(`Setting CORS on R2 bucket "${R2_BUCKET}" — origins: ${origins.join(", ")}`);
  console.log(`Methods: ${METHODS.join(", ")}`);
  const result = await putBucketCors();
  if (result.ok) {
    console.log(`\nOK — CORS policy applied (HTTP ${result.status}).`);
  } else {
    console.error(`\nFAILED (HTTP ${result.status}):\n${result.text}`);
    console.error(
      "\nFallback: set CORS manually in the Cloudflare dashboard " +
        "(R2 → bucket → Settings → CORS Policy) with the JSON in the plan.",
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
