export type StackMatchMode = "all" | "any";

const normalize = (value: string) => value.trim().toLocaleLowerCase("pt-BR");

export function matchesRequiredStacks(detectedStacks: string[], requiredStacks: string[], mode: StackMatchMode) {
  const detected = detectedStacks.map(normalize);
  const required = requiredStacks.map(normalize).filter(Boolean);
  if (!required.length) return true;
  return mode === "all"
    ? required.every((stack) => detected.includes(stack))
    : required.some((stack) => detected.includes(stack));
}
