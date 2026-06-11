import { describe, expect, test } from "bun:test";

import { buildValidatedPresenterScript } from "./script-pipeline";
import type { PresenterScript } from "./script-quality";

describe("presenter script pipeline", () => {
  test("repairs a weak first draft before returning the script", async () => {
    let repairReasons: string[] = [];
    const result = await buildValidatedPresenterScript({
      createDraft: async () => ({
        ...completeScript,
        script_text: "Fala, galera apaixonada por futebol! Vamos nessa?",
        scenes: completeScript.scenes.slice(0, 1),
      }),
      repairDraft: async ({ reasons }) => {
        repairReasons = reasons;
        return completeScript;
      },
    });

    expect(repairReasons.join(" ")).toContain("Roteiro curto demais");
    expect(result.script_text).toContain("teste de maturidade");
    expect(result.scenes).toHaveLength(6);
  });

  test("throws when repaired script is still below quality", async () => {
    await expect(buildValidatedPresenterScript({
      createDraft: async () => weakScript,
      repairDraft: async () => weakScript,
    })).rejects.toThrow("Roteiro gerado não atingiu qualidade mínima");
  });
});

const completeScript: PresenterScript = {
  title: "Neymar muda o clima da Seleção",
  hook: "A lesão do Neymar virou termômetro emocional da Seleção antes da Copa.",
  angle: "Contrapor o medo pela ausência do craque com a chance de uma geração assumir protagonismo.",
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
  quality_notes: ["Usa pesquisa, estrutura e voz opinativa."],
  word_count: 0,
};

const weakScript: PresenterScript = {
  ...completeScript,
  hook: "Fala, galera.",
  angle: "",
  promise: "",
  script_text: "Fala, galera apaixonada por futebol! Vamos nessa?",
  scenes: completeScript.scenes.slice(0, 1),
  research: {
    summary: "",
    signals: [],
    sources: [],
  },
};
