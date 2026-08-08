/** Ações operacionais que permanecem sob controle do proprietário da conta. */
export const OWNER_EMAIL = "alexsandro.ramos@gmail.com";

export function isOwnerEmail(email: string | null | undefined) {
  return email?.trim().toLowerCase() === OWNER_EMAIL;
}
