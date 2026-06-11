import { describe, expect, test } from "bun:test";

import { deleteAvatar } from "./avatar-delete";
import type { Avatar } from "./types";

function makeAvatar(overrides: Partial<Avatar> = {}): Avatar {
  return {
    id: "avatar-1",
    user_id: "user-1",
    name: "Avatar Um",
    slug: "avatar-um",
    status: "active",
    avatar_kind: "react",
    persona_summary: null,
    about: null,
    photo_path: null,
    primary_platform: "instagram",
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeSuccessfulDeleteClient(calls: string[]) {
  return {
    from(table: string) {
      calls.push(`from:${table}`);
      return {
        delete() {
          calls.push("delete");
          return {
            eq(column: string, value: string) {
              calls.push(`eq:${column}:${value}`);
              return { error: null };
            },
          };
        },
      };
    },
  };
}

describe("deleteAvatar", () => {
  test("deletes the avatar row and its profile photo", async () => {
    const calls: string[] = [];
    const removedPhotos: string[] = [];

    await deleteAvatar({
      avatar: makeAvatar({ photo_path: "user-1/avatar.webp" }),
      client: makeSuccessfulDeleteClient(calls),
      removePhoto: async (path) => {
        removedPhotos.push(path);
      },
    });

    expect(calls).toEqual(["from:avatars", "delete", "eq:id:avatar-1"]);
    expect(removedPhotos).toEqual(["user-1/avatar.webp"]);
  });

  test("does not remove a profile photo when the avatar has no photo", async () => {
    const calls: string[] = [];
    const removedPhotos: string[] = [];

    await deleteAvatar({
      avatar: makeAvatar(),
      client: makeSuccessfulDeleteClient(calls),
      removePhoto: async (path) => {
        removedPhotos.push(path);
      },
    });

    expect(calls).toEqual(["from:avatars", "delete", "eq:id:avatar-1"]);
    expect(removedPhotos).toEqual([]);
  });
});
