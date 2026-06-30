// Storage abstraction. Routes to Cloudflare R2 or Supabase based on STORAGE_BACKEND env var.
// Set STORAGE_BACKEND=r2 to activate R2; omit or set any other value to use Supabase.

import { r2Download, r2PresignDelete, r2PresignGet, r2PresignPut } from "./r2.ts";
import { createServiceClient } from "./supabase.ts";

export type VideoBucket =
  | "generated-reels"
  | "source-videos"
  | "reaction-videos"
  | "source-thumbnails"
  | "presenter-avatar-images";

function isR2Enabled(): boolean {
  return Deno.env.get("STORAGE_BACKEND") === "r2";
}

// R2 key includes the bucket name as a prefix so a single R2 bucket holds all media.
function r2Key(bucket: VideoBucket, path: string): string {
  return `${bucket}/${path}`;
}

export async function getSignedUrl(
  bucket: VideoBucket,
  path: string,
  ttlSeconds = 7200,
): Promise<string> {
  if (isR2Enabled()) {
    return r2PresignGet(r2Key(bucket, path), ttlSeconds);
  }
  const service = createServiceClient();
  const { data, error } = await service.storage.from(bucket).createSignedUrl(path, ttlSeconds);
  if (error || !data) throw new Error(error?.message ?? "Failed to create signed URL");
  return data.signedUrl;
}

export async function getBatchSignedUrls(
  bucket: VideoBucket,
  paths: string[],
  ttlSeconds = 7200,
): Promise<{ path: string; signedUrl: string | null }[]> {
  if (isR2Enabled()) {
    const results = await Promise.all(
      paths.map(async (path) => ({
        path,
        signedUrl: await r2PresignGet(r2Key(bucket, path), ttlSeconds).catch(() => null),
      })),
    );
    return results;
  }
  const service = createServiceClient();
  const { data, error } = await service.storage
    .from(bucket)
    .createSignedUrls(paths, ttlSeconds);
  if (error || !data) throw new Error(error?.message ?? "Failed to create signed URLs");
  return data.map((item) => ({ path: item.path ?? "", signedUrl: item.signedUrl ?? null }));
}

export async function getUploadUrl(
  bucket: VideoBucket,
  path: string,
  _contentType: string,
  ttlSeconds = 900,
): Promise<string> {
  if (isR2Enabled()) {
    return r2PresignPut(r2Key(bucket, path), ttlSeconds);
  }
  const service = createServiceClient();
  const { data, error } = await service.storage.from(bucket).createSignedUploadUrl(path);
  if (error || !data) throw new Error(error?.message ?? "Failed to create upload URL");
  return data.signedUrl;
}

export async function downloadBytes(bucket: VideoBucket, path: string): Promise<ArrayBuffer> {
  if (isR2Enabled()) {
    return r2Download(r2Key(bucket, path));
  }
  const service = createServiceClient();
  const { data, error } = await service.storage.from(bucket).download(path);
  if (error || !data) throw new Error(error?.message ?? "Failed to download file");
  return data.arrayBuffer();
}

export async function deleteObject(bucket: VideoBucket, path: string): Promise<void> {
  if (isR2Enabled()) {
    const url = await r2PresignDelete(r2Key(bucket, path));
    const response = await fetch(url, { method: "DELETE" });
    if (!response.ok && response.status !== 404) {
      throw new Error(`R2 delete failed: ${response.status} (key=${r2Key(bucket, path)})`);
    }
    return;
  }
  const service = createServiceClient();
  const { error } = await service.storage.from(bucket).remove([path]);
  if (error) throw new Error(error.message);
}

export async function deleteBatch(
  bucket: VideoBucket,
  paths: string[],
): Promise<void> {
  if (paths.length === 0) return;
  if (isR2Enabled()) {
    await Promise.all(paths.map((p) => deleteObject(bucket, p)));
    return;
  }
  const service = createServiceClient();
  const { error } = await service.storage.from(bucket).remove(paths);
  if (error) throw new Error(error.message);
}
