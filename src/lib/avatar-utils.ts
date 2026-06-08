export type AvatarStatus = "active" | "paused" | "draft";

export type AvatarSelectionCandidate = {
  id: string;
  status: AvatarStatus;
};

export function slugifyAvatarName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  return slug || "avatar";
}

export function resolveAvatarSelection(
  avatars: AvatarSelectionCandidate[],
  currentAvatarId: string | null | undefined,
): string | null {
  if (avatars.length === 0) {
    return null;
  }

  if (currentAvatarId && avatars.some((avatar) => avatar.id === currentAvatarId)) {
    return currentAvatarId;
  }

  return avatars.find((avatar) => avatar.status === "active")?.id ?? avatars[0].id;
}
