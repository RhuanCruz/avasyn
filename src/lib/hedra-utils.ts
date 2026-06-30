import type { HedraModel } from "@/lib/types";

const UNIT_LABEL: Record<string, string> = {
  generation: "geração",
  second: "s",
  character: "caractere",
  frame: "frame",
};

/**
 * Compact Hedra credit cost for a model, e.g. "12 créd/geração", "3 créd/s".
 * Returns null when Hedra didn't provide pricing.
 */
export function formatModelCost(
  model: Pick<HedraModel, "creditCost" | "billingUnit">,
): string | null {
  if (model.creditCost == null) return null;
  const credits = `${model.creditCost} créd`;
  if (!model.billingUnit) return credits;
  const unit = UNIT_LABEL[model.billingUnit] ?? model.billingUnit;
  return `${credits}/${unit}`;
}

/** Same as formatModelCost but appends to a label, e.g. "Hedra Avatar · 12 créd/geração". */
export function modelLabelWithCost(
  model: Pick<HedraModel, "name" | "creditCost" | "billingUnit">,
): string {
  const cost = formatModelCost(model);
  return cost ? `${model.name} · ${cost}` : model.name;
}
