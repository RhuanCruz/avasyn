import { invokeFunction } from "@/lib/api";

type SignedUrlBucket =
  | "generated-reels"
  | "source-videos"
  | "reaction-videos"
  | "source-thumbnails"
  | "presenter-avatar-images";

export async function getStorageSignedUrl(
  bucket: SignedUrlBucket,
  path: string,
): Promise<string> {
  const results = await invokeFunction<{ path: string; signedUrl: string | null }[]>(
    "get-signed-url",
    { bucket, paths: [path] },
  );
  const url = results?.[0]?.signedUrl;
  if (!url) throw new Error("Failed to get signed URL");
  return url;
}

export async function getStorageUploadUrl(
  bucket: "reaction-videos" | "source-videos" | "presenter-avatar-images",
  filename: string,
  contentType: string,
): Promise<{ path: string; uploadUrl: string }> {
  return invokeFunction("get-upload-url", { bucket, filename, contentType });
}

export async function deleteStorageObject(
  bucket: "reaction-videos" | "source-videos" | "source-thumbnails" | "presenter-avatar-images",
  paths: string | string[],
): Promise<void> {
  const normalizedPaths = Array.isArray(paths) ? paths : [paths];
  await invokeFunction("delete-storage-object", { bucket, paths: normalizedPaths });
}
