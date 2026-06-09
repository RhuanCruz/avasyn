import type { Avatar } from "./types";

type AvatarDeleteClient = {
  from(table: "avatars"): {
    delete(): {
      eq(column: "id", value: string): PromiseLike<{ error: Error | null }> | { error: Error | null };
    };
  };
};

export async function deleteAvatar({
  avatar,
  client,
  removePhoto,
}: {
  avatar: Pick<Avatar, "id" | "photo_path">;
  client: AvatarDeleteClient;
  removePhoto: (path: string) => Promise<void>;
}) {
  const { error } = await client.from("avatars").delete().eq("id", avatar.id);
  if (error) throw error;

  if (avatar.photo_path) {
    await removePhoto(avatar.photo_path);
  }
}
