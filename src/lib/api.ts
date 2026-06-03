import { supabase } from "@/lib/supabase";

export async function invokeFunction<TResponse>(
  name: string,
  body?: Record<string, unknown>,
): Promise<TResponse> {
  const { data, error } = await supabase.functions.invoke<TResponse>(name, {
    body,
  });

  if (error) {
    throw await normalizeFunctionError(error);
  }

  return data as TResponse;
}

async function normalizeFunctionError(error: unknown): Promise<Error> {
  if (
    error &&
    typeof error === "object" &&
    "context" in error &&
    error.context instanceof Response
  ) {
    try {
      const payload = await error.context.clone().json();
      if (payload?.error) {
        return new Error(String(payload.error));
      }
      return new Error(JSON.stringify(payload));
    } catch {
      const text = await error.context.clone().text();
      if (text) {
        return new Error(text);
      }
    }
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error("Edge Function returned a non-2xx status code");
}
