import { describe, expect, test } from "bun:test";

import { describeProxy, isRetriableProxyFailure, parseProxyList } from "./proxy-pool.mjs";

describe("parseProxyList", () => {
  test("aceita um proxy so, como era antes", () => {
    expect(parseProxyList("http://u:p@host:1")).toEqual(["http://u:p@host:1"]);
  });

  test("aceita varios separados por virgula", () => {
    expect(parseProxyList("http://u:p@a:1,http://u:p@b:2")).toEqual([
      "http://u:p@a:1",
      "http://u:p@b:2",
    ]);
  });

  test("tolera espaco e quebra de linha, que e como se cola de uma lista", () => {
    expect(parseProxyList(" http://a:1 ,\n http://b:2 \n")).toEqual([
      "http://a:1",
      "http://b:2",
    ]);
  });

  test("vazio e ausente viram lista vazia", () => {
    expect(parseProxyList("")).toEqual([]);
    expect(parseProxyList(undefined)).toEqual([]);
    expect(parseProxyList("   ")).toEqual([]);
  });
});

describe("isRetriableProxyFailure", () => {
  // Medido: o mesmo video passa num proxy e leva bot-check em outro. Por isso bloqueio do
  // site conta como motivo para tentar o proximo.
  test("bloqueio do YouTube justifica outro proxy", () => {
    expect(isRetriableProxyFailure("ERROR: Sign in to confirm you're not a bot")).toBe(true);
    expect(isRetriableProxyFailure("YouTube is bot-checking the worker")).toBe(true);
    expect(isRetriableProxyFailure("HTTP Error 403: Forbidden")).toBe(true);
    expect(isRetriableProxyFailure("HTTP Error 429: Too Many Requests")).toBe(true);
  });

  test("falha do proprio proxy tambem", () => {
    expect(isRetriableProxyFailure("Tunnel connection failed: 407 Proxy Authentication Required")).toBe(true);
    expect(isRetriableProxyFailure("Tunnel connection failed: 402 Payment Required")).toBe(true);
    expect(isRetriableProxyFailure("Unable to connect to proxy")).toBe(true);
  });

  // Gastar nove proxies num video que nao existe so atrasa o job para terminar igual.
  test("problema do video nao justifica", () => {
    expect(isRetriableProxyFailure("ERROR: Video unavailable")).toBe(false);
    expect(isRetriableProxyFailure("ERROR: This video is private")).toBe(false);
    expect(isRetriableProxyFailure("ERROR: Unsupported URL")).toBe(false);
    expect(isRetriableProxyFailure("File is larger than max-filesize")).toBe(false);
    expect(isRetriableProxyFailure("")).toBe(false);
    expect(isRetriableProxyFailure(null)).toBe(false);
  });
});

describe("describeProxy", () => {
  test("nunca deixa a credencial chegar no log", () => {
    const described = describeProxy("http://usuario:senhasecreta@1.2.3.4:6361");

    expect(described).toBe("1.2.3.4:6361");
    expect(described).not.toContain("senhasecreta");
    expect(described).not.toContain("usuario");
  });

  test("lida com ausencia e com valor invalido", () => {
    expect(describeProxy(undefined)).toBe("sem proxy");
    expect(describeProxy("nao e uma url")).toBe("proxy invalido");
  });
});
