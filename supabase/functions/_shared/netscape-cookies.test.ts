import { describe, expect, test } from "bun:test";

import {
  decodeCookieInput,
  parseNetscapeCookies,
  summarizeYoutubeCookies,
  validateYoutubeCookieJar,
} from "./netscape-cookies";

const NOW = Date.parse("2026-08-22T00:00:00.000Z");
const FUTURE = Math.floor(Date.parse("2026-12-01T00:00:00.000Z") / 1000);
const PAST = Math.floor(Date.parse("2026-01-01T00:00:00.000Z") / 1000);

function line(name: string, expires: number, { httpOnly = false } = {}) {
  return `${httpOnly ? "#HttpOnly_" : ""}.youtube.com\tTRUE\t/\tTRUE\t${expires}\t${name}\tREDACTED`;
}

const JAR = [
  "# Netscape HTTP Cookie File",
  "# This is a generated file! Do not edit.",
  "",
  line("__Secure-1PSID", FUTURE, { httpOnly: true }),
  line("__Secure-3PSID", FUTURE),
  line("SID", FUTURE),
  line("HSID", FUTURE),
  line("SSID", FUTURE),
  line("LOGIN_INFO", FUTURE),
  line("YSC", 0),
].join("\n");

describe("parseNetscapeCookies", () => {
  test("lê as linhas de cookie e mantém as marcadas #HttpOnly_", () => {
    const cookies = parseNetscapeCookies(JAR);

    expect(cookies).toHaveLength(7);
    expect(cookies.map((cookie) => cookie.name)).toContain("__Secure-1PSID");
  });

  test("trata expires=0 como cookie de sessão", () => {
    expect(parseNetscapeCookies(JAR).find((cookie) => cookie.name === "YSC")!.expiresAt).toBeNull();
  });

  test("ignora comentários, linhas malformadas e entrada vazia", () => {
    expect(parseNetscapeCookies("# comentário\nnao\te\tcookie")).toHaveLength(0);
    expect(parseNetscapeCookies("")).toHaveLength(0);
    expect(parseNetscapeCookies(null)).toHaveLength(0);
  });

  test("nunca expõe o valor do cookie", () => {
    for (const cookie of parseNetscapeCookies(JAR)) {
      expect(Object.keys(cookie)).not.toContain("value");
    }
  });
});

describe("summarizeYoutubeCookies", () => {
  test("resume um jar saudável", () => {
    const summary = summarizeYoutubeCookies(JAR, NOW);

    expect(summary.present).toBe(true);
    expect(summary.total).toBe(7);
    expect(summary.expired).toBe(false);
    expect(summary.missingAuthCookies).toHaveLength(0);
    expect(summary.expiresAt).toBe("2026-12-01T00:00:00.000Z");
  });

  test("acusa sessão vencida e reporta a expiração mais próxima", () => {
    const summary = summarizeYoutubeCookies(JAR.replace(line("SID", FUTURE), line("SID", PAST)), NOW);

    expect(summary.expired).toBe(true);
    expect(summary.expiresAt).toBe("2026-01-01T00:00:00.000Z");
  });

  test("lista os cookies de sessão que faltam", () => {
    const summary = summarizeYoutubeCookies(line("SID", FUTURE), NOW);

    expect(summary.missingAuthCookies).toContain("__Secure-1PSID");
    expect(summary.expired).toBe(false);
  });

  test("não quebra sem jar", () => {
    const summary = summarizeYoutubeCookies(undefined, NOW);

    expect(summary.present).toBe(false);
    expect(summary.expired).toBeNull();
  });
});

describe("validateYoutubeCookieJar", () => {
  test("aceita um jar válido", () => {
    expect(validateYoutubeCookieJar(JAR)).toEqual({ ok: true });
  });

  test("recusa texto vazio", () => {
    const result = validateYoutubeCookieJar("   \n  ");

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("vazio");
  });

  test("recusa JSON colado por engano, explicando o formato certo", () => {
    const result = validateYoutubeCookieJar('[{"name":"SID","value":"abc"}]');

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("Netscape");
  });

  test("recusa um jar sem nenhum cookie de sessão do YouTube", () => {
    const result = validateYoutubeCookieJar([line("YSC", 0), line("VISITOR_INFO1_LIVE", FUTURE)].join("\n"));

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("nenhum de sessão");
  });
});

// Guarda contra as duas cópias divergirem: o worker (worker/health-report.mjs) precisa
// concordar com este resumo, senão a tela diria "válido" enquanto o download falha.
describe("paridade com a cópia do worker", () => {
  test("mesmo resumo que worker/health-report.mjs produz", async () => {
    const workerModule = await import("../../../worker/health-report.mjs");
    const fromWorker = workerModule.summarizeYoutubeCookies(JAR, NOW);
    const fromEdge = summarizeYoutubeCookies(JAR, NOW);

    expect(fromEdge).toEqual(fromWorker);
  });
});

describe("decodeCookieInput", () => {
  test("devolve um cookies.txt intacto", () => {
    expect(decodeCookieInput(JAR)).toBe(JAR);
  });

  test("decodifica o base64 que já estava no env", () => {
    const base64 = btoa(JAR);

    expect(decodeCookieInput(base64)).toBe(JAR);
    expect(validateYoutubeCookieJar(decodeCookieInput(base64))).toEqual({ ok: true });
  });

  test("aceita base64 quebrado em linhas, como o terminal costuma imprimir", () => {
    const wrapped = btoa(JAR).replace(/(.{64})/g, "$1\n");

    expect(decodeCookieInput(wrapped)).toBe(JAR);
  });

  test("devolve o original quando não é base64 nem cookies.txt", () => {
    expect(decodeCookieInput('[{"name":"SID"}]')).toBe('[{"name":"SID"}]');
    expect(decodeCookieInput("")).toBe("");
  });
});
