import { hasValidContactEmail } from "./contact-email.ts";

/** LinkedIn é, por padrão, uma fonte de análise e candidatura pela própria
 * plataforma. Ainda assim, quando a vaga foi Aprovada (✅) e tem um e-mail de
 * contato válido registrado, o rascunho é permitido — o contato explícito
 * indica que a candidatura por e-mail também é possível para aquela vaga. */
export function isDraftAllowedForSource(input: { sourceId: string | null | undefined; verdict: string; contactEmail: string | null | undefined }): boolean {
  if (input.sourceId !== "linkedin-extension") return true;
  return input.verdict === "✅" && hasValidContactEmail(input.contactEmail);
}

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
  sourceId?: string | null;
  blocker?: string | null;
  deterministicVerdict: "BATE" | "PROVAVEL" | "NAO_BATE";
  deterministicBlocker?: string | null;
}): boolean {
  return isDraftAllowedForSource({ sourceId: input.sourceId, verdict: input.verdict, contactEmail: input.contactEmail })
    && isEligibleForDraftQueue(input)
    && !input.deterministicBlocker
    && (input.deterministicVerdict === "BATE" || input.deterministicVerdict === "PROVAVEL");
}
