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

// Force a browser download of a remote URL. Fetches into a blob so the file is
// saved (a cross-origin signed URL on a plain <a download> would just navigate).
export async function downloadUrlAsFile(url: string, filename: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Falha ao baixar o arquivo");
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function deleteStorageObject(
  bucket: "reaction-videos" | "source-videos" | "source-thumbnails" | "presenter-avatar-images",
  paths: string | string[],
): Promise<void> {
  const normalizedPaths = Array.isArray(paths) ? paths : [paths];
  await invokeFunction("delete-storage-object", { bucket, paths: normalizedPaths });
}
