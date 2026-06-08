import { describe, expect, test } from "bun:test";

import {
  resolveAvatarSelection,
  slugifyAvatarName,
} from "./avatar-utils";

describe("slugifyAvatarName", () => {
  test("normalizes a human-readable avatar name into a slug", () => {
    expect(slugifyAvatarName("Avatar Principal")).toBe("avatar-principal");
  });

  test("removes punctuation and collapses repeated separators", () => {
    expect(slugifyAvatarName(" React() // Neymar   ")).toBe("react-neymar");
  });

  test("falls back to avatar when no slug characters remain", () => {
    expect(slugifyAvatarName("!!!")).toBe("avatar");
  });
});

describe("resolveAvatarSelection", () => {
  const avatars = [
    { id: "draft", status: "draft" as const },
    { id: "active", status: "active" as const },
    { id: "paused", status: "paused" as const },
  ];

  test("keeps the current selection when it exists", () => {
    expect(resolveAvatarSelection(avatars, "paused")).toBe("paused");
  });

  test("falls back to the first active avatar", () => {
    expect(resolveAvatarSelection(avatars, "missing")).toBe("active");
  });

  test("falls back to the first avatar when no active avatar exists", () => {
    expect(
      resolveAvatarSelection(
        [{ id: "paused-a", status: "paused" as const }, { id: "draft-a", status: "draft" as const }],
        null,
      ),
    ).toBe("paused-a");
  });

  test("returns null when there are no avatars", () => {
    expect(resolveAvatarSelection([], "anything")).toBeNull();
  });
});
