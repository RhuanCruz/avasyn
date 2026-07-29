export type BulkTextCombination = {
  reactionId: string;
  sourceVideo: {
    id: string;
    name: string;
    source_platform?: string | null;
    source_url?: string | null;
  };
};

export type GeneratedBulkText = {
  caption: string;
  overlayText: string;
};

const genericOverlayTexts = [
  "Olha isso",
  "Que lance",
  "Meu Deus",
  "Sem palavras",
  "Que isso",
  "Olha aí",
  "Repara nisso",
  "Muito bom",
  "Tá doido",
  "Que cena",
];

const genericCaptions = [
  "Essa reação diz tudo.",
  "Não tinha como ignorar esse momento.",
  "Olha até o final.",
  "Esse momento merece replay.",
  "A reação veio na hora certa.",
  "Mais um daqueles para rever.",
  "Esse vídeo ficou impossível de passar batido.",
  "Quando o momento pede reação.",
];

// blockedTerms existe porque o modelo não vê o vídeo e não pode afirmar o que aconteceu
// nele. Antes era uma lista fixa de futebol ("gol", "golaço", "pênalti", "goleiro"...),
// o que embutia um tema no produto inteiro. Agora quem chama informa os termos do seu
// assunto; vazio significa confiar só na instrução do prompt.
export function normalizeGeneratedTexts(
  items: GeneratedBulkText[],
  combinations: BulkTextCombination[],
  blockedTerms: string[] = [],
) {
  const usedCaptions = new Set<string>();
  const usedOverlays = new Set<string>();

  return items.map((item, index) => {
    let overlayText = sanitizeOverlayText(item.overlayText);
    if (
      !overlayText ||
      hasContentSpecificGuess(overlayText, blockedTerms) ||
      usedOverlays.has(overlayText.toLowerCase())
    ) {
      overlayText = nextUnused(genericOverlayTexts, usedOverlays, index);
    }
    overlayText = sanitizeOverlayText(overlayText);
    usedOverlays.add(overlayText.toLowerCase());

    let caption = sanitizeCaption(item.caption);
    if (
      !caption ||
      hasContentSpecificGuess(caption, blockedTerms) ||
      usedCaptions.has(caption.toLowerCase())
    ) {
      caption = nextUnused(genericCaptions, usedCaptions, index);
    }
    usedCaptions.add(caption.toLowerCase());

    return { caption, overlayText };
  });
}

function nextUnused(values: string[], used: Set<string>, startIndex: number) {
  for (let offset = 0; offset < values.length; offset += 1) {
    const value = values[(startIndex + offset) % values.length];
    if (!used.has(value.toLowerCase())) return value;
  }
  return values[startIndex % values.length];
}

function sanitizeOverlayText(value: string) {
  return firstWords(
    String(value)
      .replace(/[#@][\p{L}\p{N}_-]+/gu, "")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim(),
    3,
  );
}

function firstWords(value: string, maxWords: number) {
  return String(value)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords)
    .join(" ");
}

function sanitizeCaption(value: string) {
  return String(value).replace(/\s+/g, " ").trim().slice(0, 280);
}

function hasContentSpecificGuess(value: string, blockedTerms: string[]) {
  if (blockedTerms.length === 0) return false;
  const normalized = normalizeForMatch(value);
  return blockedTerms.some((term) => {
    const normalizedTerm = normalizeForMatch(term);
    return normalizedTerm.length > 0 && normalized.includes(normalizedTerm);
  });
}

function normalizeForMatch(value: string) {
  return String(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}
