/** Um contato é utilizável somente se houver exatamente um endereço de e-mail
 * completo. Não tentamos deduzir destinatários nem aceitamos listas. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeContactEmail(value: string | null | undefined): string | null {
  const email = value?.trim().toLowerCase() ?? "";
  return EMAIL_PATTERN.test(email) ? email : null;
}

export function hasValidContactEmail(value: string | null | undefined): boolean {
  return normalizeContactEmail(value) !== null;
}
