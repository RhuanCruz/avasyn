// Structured-output LLM client over the OpenAI-compatible /chat/completions API.
// Works with DeepSeek (default: deepseek-v4-flash) and any OpenAI-compatible host.
//
// Configurable via env (set as Supabase function secrets):
//   LLM_API_KEY   – API key (falls back to DEEPSEEK_API_KEY, then OPENAI_API_KEY)
//   LLM_API_BASE  – base URL (default https://api.deepseek.com)
//   LLM_MODEL     – model id (default deepseek-v4-flash)
//
// Note: deepseek-v4 models are *reasoning* models — they spend completion tokens
// on hidden reasoning before emitting the answer, so we add generous headroom on
// top of the caller's answer budget or the JSON comes back truncated/empty.

type ResponsesInput = Array<{
  role: "developer" | "user";
  content: Array<{ type: "input_text"; text: string }>;
}>;

type ChatMessage = { role: "system" | "user"; content: string };

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-v4-flash";
// Headroom for reasoning tokens consumed before the JSON answer is produced.
const REASONING_HEADROOM_TOKENS = 2000;

function llmConfig() {
  const apiKey = Deno.env.get("LLM_API_KEY") ??
    Deno.env.get("DEEPSEEK_API_KEY") ??
    Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    throw new Error("LLM_API_KEY (or DEEPSEEK_API_KEY) is required");
  }
  const baseUrl = (Deno.env.get("LLM_API_BASE") ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const model = Deno.env.get("LLM_MODEL") ?? DEFAULT_MODEL;
  return { apiKey, baseUrl, model };
}

export async function createStructuredResponse<T>({
  input,
  maxOutputTokens = 4000,
  model,
  schema,
  schemaName,
  // OpenAI Responses-API built-in tools (e.g. web_search) have no equivalent on
  // /chat/completions, so they are accepted for signature compatibility but
  // ignored. Callers that relied on web_search degrade to no live browsing.
  tools: _tools,
  toolChoice: _toolChoice,
}: {
  input: ResponsesInput;
  maxOutputTokens?: number;
  model?: string;
  schema: Record<string, unknown>;
  schemaName: string;
  tools?: Array<Record<string, unknown>>;
  toolChoice?: string | Record<string, unknown>;
}): Promise<T> {
  const cfg = llmConfig();
  const messages = buildMessages(input, schema, schemaName);

  const response = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model ?? cfg.model,
      messages,
      response_format: { type: "json_object" },
      max_tokens: maxOutputTokens + REASONING_HEADROOM_TOKENS,
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`LLM request failed: ${raw}`);
  }

  const parsed = JSON.parse(raw) as {
    choices?: Array<{ finish_reason?: string; message?: { content?: string } }>;
  };
  const choice = parsed.choices?.[0];
  const content = choice?.message?.content?.trim();
  if (!content) {
    const reason = choice?.finish_reason ?? "unknown";
    throw new Error(`LLM returned no content (finish_reason=${reason})`);
  }

  return JSON.parse(stripJsonFences(content)) as T;
}

// Responses-API style input → chat messages ("developer" → "system"). The JSON
// Schema is appended as a trailing system instruction because json_object mode
// does not enforce a schema by itself, and DeepSeek requires the literal word
// "json" to appear somewhere in the prompt to enable JSON output.
function buildMessages(
  input: ResponsesInput,
  schema: Record<string, unknown>,
  schemaName: string,
): ChatMessage[] {
  const messages: ChatMessage[] = input.map((item) => ({
    role: item.role === "developer" ? "system" : "user",
    content: item.content.map((part) => part.text).join("\n"),
  }));
  messages.push({
    role: "system",
    content: `Responda com um único objeto JSON válido (sem markdown, sem texto fora do JSON) ` +
      `chamado "${schemaName}", seguindo exatamente este JSON Schema:\n${JSON.stringify(schema)}`,
  });
  return messages;
}

function stripJsonFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}
