#!/usr/bin/env node
// One-off script to purge all objects from Supabase Storage video buckets.
// Uses the Storage REST API (not SQL) so files are actually deleted from S3.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/purge-storage.mjs
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/purge-storage.mjs reaction-videos

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.");
  process.exit(1);
}

const ALL_BUCKETS = ["generated-reels", "source-videos", "reaction-videos", "source-thumbnails"];
const targetBuckets = process.argv[2] ? [process.argv[2]] : ALL_BUCKETS;

const headers = {
  "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
  "apikey": SERVICE_ROLE_KEY,
};

async function listObjects(bucket, prefix = "", limit = 1000, offset = 0) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${bucket}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ prefix, limit, offset, sortBy: { column: "name", order: "asc" } }),
  });
  if (!res.ok) throw new Error(`list failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function deleteObjects(bucket, paths) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}`, {
    method: "DELETE",
    headers,
    body: JSON.stringify({ prefixes: paths }),
  });
  if (!res.ok) throw new Error(`delete failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function purge(bucket) {
  console.log(`\nPurging bucket: ${bucket}`);
  let total = 0;
  let offset = 0;
  const batchSize = 100;

  while (true) {
    const items = await listObjects(bucket, "", batchSize, offset);
    if (!items || items.length === 0) break;

    // Filter out folders (null size = folder placeholder)
    const filePaths = items
      .filter((item) => item.metadata !== null)
      .map((item) => item.name);

    if (filePaths.length > 0) {
      await deleteObjects(bucket, filePaths);
      total += filePaths.length;
      console.log(`  Deleted ${total} objects...`);
    }

    if (items.length < batchSize) break;
    offset += batchSize;
  }

  console.log(`  Done — ${total} objects deleted from ${bucket}`);
}

async function main() {
  for (const bucket of targetBuckets) {
    try {
      await purge(bucket);
    } catch (err) {
      console.error(`Error purging ${bucket}:`, err.message);
    }
  }
  console.log("\nStorage purge complete. Sizes in the Supabase dashboard update within ~1h.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
