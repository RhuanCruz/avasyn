import { describe, expect, test } from "bun:test";

import {
  fetchScrapeCreatorsTikTok,
  findScrapeCreatorsVideoUrl,
  normalizeScrapeCreatorsTikTokCandidate,
} from "./scrapecreators-tiktok.mjs";

const DETAIL = {
  aweme_id: "7694502367357570325",
  desc: "Baila Lamine!!",
  create_time: 1790000000,
  statistics: { play_count: 363000, digg_count: 11000 },
  author: { unique_id: "absolutemessi" },
  video: {
    duration: 40250,
    download_addr: { url_list: ["https://cdn/com-marca.mp4"] },
    play_addr_h264: { url_list: ["https://cdn/h264.mp4", "https://cdn/h264-b.mp4"] },
    play_addr: { url_list: ["https://cdn/play.mp4"] },
  },
};

describe("findScrapeCreatorsVideoUrl", () => {
  test("prefere h264 e nunca a versao com marca d'agua", () => {
    expect(findScrapeCreatorsVideoUrl(DETAIL)).toBe("https://cdn/h264.mp4");
  });

  test("cai para play_addr quando nao ha h264", () => {
    const { play_addr_h264, ...video } = DETAIL.video;
    expect(findScrapeCreatorsVideoUrl({ video })).toBe("https://cdn/play.mp4");
  });

  test("devolve null sem nenhuma URL utilizavel", () => {
    expect(findScrapeCreatorsVideoUrl({ video: { download_addr: { url_list: ["https://x"] } } })).toBeNull();
    expect(findScrapeCreatorsVideoUrl(null)).toBeNull();
  });
});

describe("normalizeScrapeCreatorsTikTokCandidate", () => {
  test("converte duracao de ms para segundos e mapeia as metricas", () => {
    const c = normalizeScrapeCreatorsTikTokCandidate(DETAIL, "https://www.tiktok.com/@x/video/1");

    expect(c.externalId).toBe("7694502367357570325");
    expect(c.platform).toBe("tiktok");
    expect(c.metadata.duration).toBe(40);
    expect(c.metadata.view_count).toBe(363000);
    expect(c.metadata.like_count).toBe(11000);
    expect(c.metadata.uploader).toBe("absolutemessi");
  });

  test("nao quebra com resposta vazia", () => {
    const c = normalizeScrapeCreatorsTikTokCandidate({}, "https://x");

    expect(c.metadata.title).toBe("TikTok importado");
    expect(c.metadata.duration).toBeNull();
  });
});

describe("fetchScrapeCreatorsTikTok", () => {
  test("exige a chave", async () => {
    await expect(fetchScrapeCreatorsTikTok({ sourceUrl: "https://x" })).rejects.toThrow("not configured");
  });

  test("manda a chave no header e a URL por query", async () => {
    let seen;
    const fetchImpl = async (url, init) => {
      seen = { url: String(url), key: init.headers["x-api-key"] };
      return new Response(JSON.stringify({ aweme_detail: DETAIL }), { status: 200 });
    };

    const detail = await fetchScrapeCreatorsTikTok({ apiKey: "k", sourceUrl: "https://t/v/1", fetchImpl });

    expect(seen.key).toBe("k");
    expect(seen.url).toContain("url=https%3A%2F%2Ft%2Fv%2F1");
    expect(detail.aweme_id).toBe("7694502367357570325");
  });

  test("propaga erro HTTP com o corpo, para o diagnostico", async () => {
    const fetchImpl = async () => new Response("out of credits", { status: 402 });

    await expect(
      fetchScrapeCreatorsTikTok({ apiKey: "k", sourceUrl: "https://x", fetchImpl }),
    ).rejects.toThrow(/402.*out of credits/);
  });
});
