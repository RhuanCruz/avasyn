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
  "Essa reação diz tudo. #futebol",
  "Não tinha como ignorar esse lance. #futebol",
  "Olha até o final. #futebol",
  "Esse momento merece replay. #futebol",
  "A reação veio na hora certa. #futebol",
  "Mais um daqueles lances para rever. #futebol",
  "Esse vídeo ficou impossível de passar batido. #futebol",
  "Quando o lance pede reação. #futebol",
];

const contentSpecificTerms = [
  "assistencia",
  "bicicleta",
  "chute",
  "craque",
  "defesa",
  "defendeu",
  "drible",
  "falta",
  "finalizacao",
  "frango",
  "goleiro",
  "gol",
  "golaco",
  "penalti",
  "pênalti",
  "salvou",
];

export function normalizeGeneratedTexts(
  items: GeneratedBulkText[],
  combinations: BulkTextCombination[],
) {
  const usedCaptions = new Set<string>();
  const usedOverlays = new Set<string>();

  return items.map((item, index) => {
    let overlayText = sanitizeOverlayText(item.overlayText);
    if (
      !overlayText ||
      hasContentSpecificGuess(overlayText) ||
      usedOverlays.has(overlayText.toLowerCase())
    ) {
      overlayText = nextUnused(genericOverlayTexts, usedOverlays, index);
    }
    overlayText = sanitizeOverlayText(overlayText);
    usedOverlays.add(overlayText.toLowerCase());

    let caption = sanitizeCaption(item.caption);
    if (
      !caption ||
      hasContentSpecificGuess(caption) ||
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

function hasContentSpecificGuess(value: string) {
  const normalized = normalizeForMatch(value);
  return contentSpecificTerms.some((term) => normalized.includes(normalizeForMatch(term)));
}

function normalizeForMatch(value: string) {
  return String(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}
