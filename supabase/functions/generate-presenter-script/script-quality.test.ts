import { describe, expect, test } from "bun:test";

import {
  normalizePresenterScript,
  type PresenterScript,
  validatePresenterScript,
} from "./script-quality";

const validScript: PresenterScript = {
  title: "Neymar muda o clima da Seleção",
  hook: "A lesão do Neymar virou termômetro emocional da Seleção antes da Copa.",
  angle: "O roteiro contrapõe a ausência do craque com a chance real de uma geração assumir protagonismo.",
  promise: "Mostrar por que a preocupação existe, mas não precisa virar desespero.",
  script_text: [
    "A lesão do Neymar não é só uma notícia médica: é um teste de maturidade para a Seleção.",
    "A CBF fala em boa evolução, mas o histórico dele em Copas pesa no imaginário do torcedor.",
    "O ponto é que o Brasil já não depende de uma única estrela para criar esperança.",
    "Vini Jr. chega com status, Rodrygo tem decisão, Endrick carrega novidade e Rafinha pode dar equilíbrio.",
    "A pergunta real não é se Neymar faz falta. Faz. A pergunta é se essa ausência obriga outros nomes a pararem de jogar como coadjuvantes.",
    "Se a resposta vier agora, a lesão deixa de ser só um problema e vira o primeiro grande filtro emocional da campanha.",
  ].join(" "),
  scenes: [
    { beat: "Hook", narration: "A lesão do Neymar não é só uma notícia médica: é um teste de maturidade para a Seleção.", on_screen_text: "Teste de maturidade" },
    { beat: "Contexto", narration: "A CBF fala em boa evolução, mas o histórico dele em Copas pesa no imaginário do torcedor.", on_screen_text: "Histórico pesa" },
    { beat: "Virada", narration: "O ponto é que o Brasil já não depende de uma única estrela para criar esperança.", on_screen_text: "Não é um jogador só" },
    { beat: "Elenco", narration: "Vini Jr. chega com status, Rodrygo tem decisão, Endrick carrega novidade e Rafinha pode dar equilíbrio.", on_screen_text: "Nova geração" },
    { beat: "Tensão", narration: "A pergunta real não é se Neymar faz falta. Faz. A pergunta é se essa ausência obriga outros nomes a pararem de jogar como coadjuvantes.", on_screen_text: "Quem assume?" },
    { beat: "Fechamento", narration: "Se a resposta vier agora, a lesão deixa de ser só um problema e vira o primeiro grande filtro emocional da campanha.", on_screen_text: "Filtro emocional" },
  ],
  research: {
    summary: "Fontes recentes indicam lesão muscular, exames e expectativa de recuperação.",
    signals: ["Lesão muscular confirmada", "Histórico de lesões em Copas", "Discussão sobre protagonismo da nova geração"],
    sources: [{ title: "Neymar passa por exames", url: "https://example.com/neymar-exames" }],
  },
  safety_notes: [],
  quality_notes: ["Evita cravar prazo médico sem fonte."],
  word_count: 0,
};

describe("presenter script quality", () => {
  test("rejects scripts that are too short", () => {
    const result = validatePresenterScript({
      ...validScript,
      script_text: "A lesão do Neymar preocupa, mas ainda existe esperança para a Seleção.",
      scenes: validScript.scenes.slice(0, 1),
    });

    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toContain("Roteiro curto demais");
    expect(result.reasons.join(" ")).toContain("Poucas cenas");
  });

  test("rejects scripts without enough beats", () => {
    const result = validatePresenterScript({
      ...validScript,
      scenes: validScript.scenes.slice(0, 4),
    });

    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toContain("Poucas cenas");
  });

  test("accepts complete scripts with research and structure", () => {
    const result = validatePresenterScript(validScript);

    expect(result.ok).toBe(true);
    expect(result.wordCount).toBeGreaterThanOrEqual(90);
  });

  test("rejects URLs and raw dates in spoken script text", () => {
    const result = validatePresenterScript({
      ...validScript,
      script_text: `${validScript.script_text} Fonte: https://example.com em 10/06/2026.`,
    });

    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toContain("contém URL");
    expect(result.reasons.join(" ")).toContain("contém data crua");
  });

  test("recomposes script text from scene narration when scenes are stronger", () => {
    const normalized = normalizePresenterScript({
      ...validScript,
      script_text: "Curto demais.",
      word_count: 0,
    });

    expect(normalized.script_text).toContain("teste de maturidade");
    expect(normalized.word_count).toBeGreaterThan(90);
  });
});
