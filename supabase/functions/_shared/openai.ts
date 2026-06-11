type ResponsesInput = Array<{
  role: "developer" | "user";
  content: Array<{ type: "input_text"; text: string }>;
}>;

export async function createStructuredResponse<T>({
  input,
  maxOutputTokens = 4000,
  model = Deno.env.get("OPENAI_MODEL") ?? "gpt-4.1-mini",
  schema,
  schemaName,
  tools,
  toolChoice,
}: {
  input: ResponsesInput;
  maxOutputTokens?: number;
  model?: string;
  schema: Record<string, unknown>;
  schemaName: string;
  tools?: Array<Record<string, unknown>>;
  toolChoice?: string | Record<string, unknown>;
}): Promise<T> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input,
      ...(tools ? { tools } : {}),
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
      max_output_tokens: maxOutputTokens,
      text: {
        format: {
          type: "json_schema",
          name: schemaName,
          strict: true,
          schema,
        },
      },
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI request failed: ${raw}`);
  }

  const parsedResponse = JSON.parse(raw);
  const outputText = extractOutputText(parsedResponse);
  if (!outputText) {
    throw new Error("OpenAI returned no structured text");
  }

  return JSON.parse(outputText) as T;
}

function extractOutputText(response: unknown) {
  const candidate = response as {
    output?: Array<{ content?: Array<{ text?: string; type?: string }> }>;
    output_text?: string;
  };
  if (candidate.output_text) return candidate.output_text;
  return candidate.output
    ?.flatMap((item) => item.content ?? [])
    .find((content) => content.type === "output_text" && content.text)
    ?.text ?? null;
}
