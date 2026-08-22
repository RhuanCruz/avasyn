/**
 * Transforma qualquer coisa lançada numa mensagem legível.
 *
 * Existe porque `error instanceof Error` é falso para o que o supabase-js lança: um
 * PostgrestError é um objeto simples com { message, code, details, hint }. O padrão
 * `error instanceof Error ? error.message : "Unknown error"` transformava toda falha de
 * banco em "Unknown error" — exatamente a informação que se precisa para consertar.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const parts = [record.code, record.message, record.details, record.hint]
      .filter((part) => part !== null && part !== undefined && part !== "")
      .map(String);

    if (parts.length > 0) return parts.join(": ");

    try {
      return JSON.stringify(error);
    } catch {
      // Objeto com referência circular; cai no fallback abaixo.
    }
  }

  if (typeof error === "string" && error.trim() !== "") return error;

  return "Unknown error";
}

/**
 * `42P01 = undefined_table`. Acontece quando a edge function foi publicada mas a migration
 * não rodou — e a mensagem crua do Postgres não diz o que fazer a respeito.
 */
export function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  return record.code === "42P01"
    || /relation .* does not exist/i.test(String(record.message ?? ""));
}
