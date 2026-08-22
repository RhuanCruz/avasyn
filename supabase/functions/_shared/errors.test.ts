import { describe, expect, test } from "bun:test";

import { describeError, isMissingTableError } from "./errors";

// Formato real do que o supabase-js devolve em `{ data, error }`.
const POSTGREST_ERROR = {
  code: "42P01",
  message: 'relation "public.worker_credentials" does not exist',
  details: null,
  hint: null,
};

describe("describeError", () => {
  test("usa a mensagem de um Error normal", () => {
    expect(describeError(new Error("algo quebrou"))).toBe("algo quebrou");
  });

  // O bug que motivou este helper: isto virava "Unknown error" e escondia a causa.
  test("extrai código e mensagem de um PostgrestError", () => {
    const described = describeError(POSTGREST_ERROR);

    expect(described).toContain("42P01");
    expect(described).toContain("worker_credentials");
    expect(described).not.toBe("Unknown error");
  });

  test("junta details e hint quando existem", () => {
    const described = describeError({
      code: "23503",
      message: "insert violates foreign key",
      details: "Key (updated_by) is not present in table users",
      hint: "confira o usuário",
    });

    expect(described).toContain("23503");
    expect(described).toContain("Key (updated_by)");
    expect(described).toContain("confira o usuário");
  });

  test("serializa um objeto sem campos conhecidos", () => {
    expect(describeError({ foo: "bar" })).toBe('{"foo":"bar"}');
  });

  test("aceita string solta", () => {
    expect(describeError("falhou feio")).toBe("falhou feio");
  });

  test("cai no fallback só quando não há nada aproveitável", () => {
    expect(describeError(null)).toBe("Unknown error");
    expect(describeError(undefined)).toBe("Unknown error");
    expect(describeError("")).toBe("Unknown error");
    expect(describeError({})).toBe("{}");
  });

  test("não estoura com referência circular", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => describeError(circular)).not.toThrow();
    expect(describeError(circular)).toBe("Unknown error");
  });
});

describe("isMissingTableError", () => {
  test("reconhece o código 42P01", () => {
    expect(isMissingTableError(POSTGREST_ERROR)).toBe(true);
  });

  test("reconhece pela mensagem quando o código não vem", () => {
    expect(isMissingTableError({ message: 'relation "x" does not exist' })).toBe(true);
  });

  test("não confunde com outros erros", () => {
    expect(isMissingTableError({ code: "23503", message: "foreign key" })).toBe(false);
    expect(isMissingTableError(new Error("relation does not exist"))).toBe(false);
    expect(isMissingTableError(null)).toBe(false);
  });
});
