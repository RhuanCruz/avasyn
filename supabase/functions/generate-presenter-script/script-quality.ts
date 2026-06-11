export type PresenterScriptScene = {
  beat: string;
  narration: string;
  on_screen_text: string;
};

export type PresenterScriptSource = {
  title: string;
  url: string;
};

export type PresenterScript = {
  title: string;
  hook: string;
  angle: string;
  promise: string;
  script_text: string;
  scenes: PresenterScriptScene[];
  research: {
    summary: string;
    signals: string[];
    sources: PresenterScriptSource[];
  };
  safety_notes: string[];
  quality_notes: string[];
  word_count: number;
};

export type ScriptValidationResult = {
  ok: boolean;
  reasons: string[];
  wordCount: number;
};

const MIN_WORDS = 90;
const MIN_SCENES = 5;
const MIN_SOURCES = 1;

const GENERIC_OPENERS = [
  "fala, galera",
  "olá, pessoal",
  "oi, pessoal",
  "vamos nessa",
  "hoje vamos falar",
  "neste vídeo",
  "trazendo as últimas",
];

const URL_PATTERN = /(?:https?:\/\/|www\.)\S+/i;
const RAW_DATE_PATTERN = /\b(?:\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\d{4}-\d{2}-\d{2})\b/;

export function normalizePresenterScript(script: PresenterScript): PresenterScript {
  const sceneScript = composeScriptText(script.scenes);
  const currentScript = cleanWhitespace(script.script_text);
  const bestScript = countWords(sceneScript) > countWords(currentScript)
    ? sceneScript
    : currentScript;
  const wordCount = countWords(bestScript);

  return {
    ...script,
    hook: cleanWhitespace(script.hook),
    angle: cleanWhitespace(script.angle),
    promise: cleanWhitespace(script.promise),
    script_text: bestScript,
    word_count: wordCount,
    scenes: script.scenes.map((scene) => ({
      beat: cleanWhitespace(scene.beat),
      narration: cleanWhitespace(scene.narration),
      on_screen_text: cleanWhitespace(scene.on_screen_text),
    })),
  };
}

export function validatePresenterScript(script: PresenterScript): ScriptValidationResult {
  const normalized = normalizePresenterScript(script);
  const reasons: string[] = [];
  const wordCount = countWords(normalized.script_text);

  if (wordCount < MIN_WORDS) {
    reasons.push(`Roteiro curto demais: ${wordCount} palavras; mínimo ${MIN_WORDS}.`);
  }

  if (normalized.scenes.length < MIN_SCENES) {
    reasons.push(`Poucas cenas/beats: ${normalized.scenes.length}; mínimo ${MIN_SCENES}.`);
  }

  const usableSources = normalized.research.sources.filter((source) => isHttpUrl(source.url));
  if (usableSources.length < MIN_SOURCES) {
    reasons.push("Pesquisa sem fonte web utilizável.");
  }

  if (normalized.research.signals.length === 0 || !normalized.research.summary.trim()) {
    reasons.push("Pesquisa sem sinais ou resumo editorial.");
  }

  if (!normalized.hook.trim() || countWords(normalized.hook) < 6) {
    reasons.push("Hook fraco ou vazio.");
  }

  if (!normalized.angle.trim() || countWords(normalized.angle) < 6) {
    reasons.push("Ângulo editorial fraco ou vazio.");
  }

  if (!normalized.promise.trim() || countWords(normalized.promise) < 5) {
    reasons.push("Promessa do vídeo fraca ou vazia.");
  }

  if (looksGeneric(normalized.script_text)) {
    reasons.push("Roteiro começa de forma genérica; precisa abrir com tensão, dado ou contraste.");
  }

  reasons.push(...validateSpokenScriptText([
    normalized.script_text,
    ...normalized.scenes.map((scene) => scene.narration),
  ].join(" ")));

  return {
    ok: reasons.length === 0,
    reasons,
    wordCount,
  };
}

export function validateSpokenScriptText(text: string) {
  const reasons: string[] = [];
  if (URL_PATTERN.test(text)) {
    reasons.push("Texto falado contém URL; links devem ficar só nas fontes da pesquisa.");
  }
  if (RAW_DATE_PATTERN.test(text)) {
    reasons.push("Texto falado contém data crua; reescreva como linguagem natural ou remova.");
  }
  return reasons;
}

export function composeScriptText(scenes: PresenterScriptScene[]) {
  return cleanWhitespace(
    scenes
      .map((scene) => scene.narration)
      .filter(Boolean)
      .join("\n\n"),
  );
}

export function countWords(text: string) {
  return (text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)?/gu) ?? []).length;
}

function cleanWhitespace(text: string) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function looksGeneric(text: string) {
  const lower = cleanWhitespace(text).toLocaleLowerCase("pt-BR");
  return GENERIC_OPENERS.some((opener) => lower.startsWith(opener));
}

function isHttpUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
