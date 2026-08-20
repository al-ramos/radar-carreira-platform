import type { StructuredJobFacts } from "./ai-provider";
import type { DeterministicTriage } from "./deterministic-triage";

export type AiRefinementEffect = {
  verdict: DeterministicTriage["verdict"];
  label: string;
  blocker: string | null;
  effect: "confirmed" | "downgraded";
  reason: string;
};

/**
 * Política conservadora para a primeira automação de IA:
 * - bloqueadores das regras nunca são removidos;
 * - a IA pode confirmar a decisão ou rebaixá-la quando encontra uma exigência
 *   objetiva que as regras não tinham visto;
 * - a IA nunca eleva automaticamente uma vaga. Isso evita criar candidatura
 *   a partir de uma inferência e deixa qualquer promoção para revisão humana.
 */
export function applyAiRefinement(rules: DeterministicTriage, facts: StructuredJobFacts): AiRefinementEffect {
  if (rules.blocker) return { verdict: rules.verdict, label: rules.result.label, blocker: rules.blocker, effect: "confirmed", reason: "Bloqueador determinístico preservado." };

  const language = facts.languageRequirement.toLocaleLowerCase("pt-BR");
  const advancedLanguage = /(ingl[eê]s|english).{0,32}(fluente|avançado|advanced|c1|c2)|(?:fluente|avançado|advanced|c1|c2).{0,32}(ingl[eê]s|english)/i.test(language);
  if (advancedLanguage) {
    return {
      verdict: "NAO_BATE",
      label: "Bloqueador confirmado pela IA",
      blocker: `IA confirmou exigência de idioma: ${facts.languageRequirement}`,
      effect: "downgraded",
      reason: "A IA encontrou uma exigência objetiva de idioma avançado na descrição.",
    };
  }

  return {
    verdict: rules.verdict,
    label: rules.result.label,
    blocker: rules.blocker,
    effect: "confirmed",
    reason: facts.ambiguities.length ? "IA extraiu fatos, mas as ambiguidades restantes não alteram o veredito." : "IA confirmou os fatos sem identificar bloqueador adicional.",
  };
}
