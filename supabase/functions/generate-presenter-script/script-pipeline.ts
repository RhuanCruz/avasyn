import {
  normalizePresenterScript,
  type PresenterScript,
  validatePresenterScript,
} from "./script-quality.ts";

export async function buildValidatedPresenterScript({
  createDraft,
  repairDraft,
}: {
  createDraft: () => Promise<PresenterScript>;
  repairDraft: (input: {
    firstDraft: PresenterScript;
    reasons: string[];
  }) => Promise<PresenterScript>;
}) {
  const firstDraft = await createDraft();
  let result = normalizePresenterScript(firstDraft);
  let validation = validatePresenterScript(result);

  if (!validation.ok) {
    const repaired = await repairDraft({
      firstDraft: result,
      reasons: validation.reasons,
    });
    result = normalizePresenterScript(repaired);
    validation = validatePresenterScript(result);
  }

  if (!validation.ok) {
    throw new Error(`Roteiro gerado não atingiu qualidade mínima: ${validation.reasons.join(" ")}`);
  }

  return result;
}
