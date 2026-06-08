import { describe, expect, test } from "bun:test";

import { normalizeGeneratedTexts } from "./bulk-texts";

const combinations = [
  {
    reactionId: "reaction-1",
    sourceVideo: {
      id: "source-1",
      name: "clip-sem-contexto-1.mp4",
      source_platform: null,
      source_url: null,
    },
  },
  {
    reactionId: "reaction-2",
    sourceVideo: {
      id: "source-2",
      name: "clip-sem-contexto-2.mp4",
      source_platform: null,
      source_url: null,
    },
  },
];

describe("normalizeGeneratedTexts", () => {
  test("replaces content-specific overlay guesses with generic reactions", () => {
    const texts = normalizeGeneratedTexts(
      [
        {
          caption: "Defesa sensacional do goleiro.",
          overlayText: "Defesa sensacional",
        },
        {
          caption: "Golaço absurdo no fim.",
          overlayText: "Golaço absurdo",
        },
      ],
      combinations,
    );

    expect(texts.map((item) => item.overlayText)).toEqual(["Olha isso", "Que lance"]);
    expect(texts[0].caption).not.toContain("Defesa sensacional");
    expect(texts[1].caption).not.toContain("Golaço");
  });
});
