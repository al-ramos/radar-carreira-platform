import { hasValidContactEmail } from "./contact-email.ts";

/** A fila de rascunhos aceita somente vereditos aproveitáveis e um contato
 * explícito e válido já cadastrado na vaga. */
export function isEligibleForDraftQueue(input: { verdict: string; contactEmail: string | null | undefined; blocker?: string | null }): boolean {
  return (input.verdict === "✅" || input.verdict === "🟡")
    && !input.blocker
    && hasValidContactEmail(input.contactEmail);
}

/**
 * Defesa final contra histórico desatualizado: mesmo que uma análise anterior
 * tenha aprovado a vaga, o rascunho só pode existir se a avaliação
 * determinística atual ainda a classificar como aderente ou provável.
 */
export function isSafeForDraft(input: {
  verdict: string;
  contactEmail: string | null | undefined;
  blocker?: string | null;
  deterministicVerdict: "BATE" | "PROVAVEL" | "NAO_BATE";
  deterministicBlocker?: string | null;
}): boolean {
  return isEligibleForDraftQueue(input)
    && !input.deterministicBlocker
    && (input.deterministicVerdict === "BATE" || input.deterministicVerdict === "PROVAVEL");
}
