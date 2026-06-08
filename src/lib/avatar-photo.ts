import { supabase } from "@/lib/supabase";

export const AVATAR_PHOTO_BUCKET = "avatar-photos";

export async function uploadAvatarPhoto(userId: string, file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const storagePath = `${userId}/${crypto.randomUUID()}.${extension}`;

  const { error } = await supabase.storage
    .from(AVATAR_PHOTO_BUCKET)
    .upload(storagePath, file, {
      contentType: file.type || "image/jpeg",
      upsert: false,
    });

  if (error) throw error;
  return storagePath;
}

export async function createAvatarPhotoUrl(path: string | null | undefined) {
  if (!path) return null;

  const { data, error } = await supabase.storage
    .from(AVATAR_PHOTO_BUCKET)
    .createSignedUrl(path, 60 * 30);

  if (error) throw error;
  return data.signedUrl;
}

export async function removeAvatarPhoto(path: string | null | undefined) {
  if (!path) return;
  await supabase.storage.from(AVATAR_PHOTO_BUCKET).remove([path]);
}
