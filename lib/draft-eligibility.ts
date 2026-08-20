import { hasValidContactEmail } from "./contact-email.ts";

/** A fila de rascunhos aceita somente vereditos aproveitáveis e um contato
 * explícito e válido já cadastrado na vaga. */
export function isEligibleForDraftQueue(input: { verdict: string; contactEmail: string | null | undefined }): boolean {
  return (input.verdict === "✅" || input.verdict === "🟡") && hasValidContactEmail(input.contactEmail);
}
