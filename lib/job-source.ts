export const LINKEDIN_SOURCE_ID = "linkedin-extension";
export const APINFO_SOURCE_ID = "apinfo-extension";
export const OTHER_SOURCE_ID = "other-import";

/**
 * Toda vaga que entra pelo arquivo precisa de uma origem exibível. As fontes
 * conhecidas são detectadas pelo link; os demais links formam a origem
 * genérica "Outras fontes". Assim, a interface nunca precisa chamar uma vaga
 * importada de "fonte não informada".
 */
export function inferJobSourceId(url: string, suppliedSource?: string): string {
  const source = suppliedSource?.trim().toLowerCase();
  if (source === LINKEDIN_SOURCE_ID || source === "linkedin") return LINKEDIN_SOURCE_ID;
  if (source === APINFO_SOURCE_ID || source === "apinfo" || source === "apinfo.com") return APINFO_SOURCE_ID;
  if (source === OTHER_SOURCE_ID || source === "outras fontes" || source === "outra fonte") return OTHER_SOURCE_ID;

  const link = url.toLowerCase();
  if (link.includes("linkedin.com")) return LINKEDIN_SOURCE_ID;
  if (link.includes("apinfo.com")) return APINFO_SOURCE_ID;
  return OTHER_SOURCE_ID;
}

export function jobSourceLabel(source: string): string {
  if (source === LINKEDIN_SOURCE_ID) return "LinkedIn";
  if (source === APINFO_SOURCE_ID) return "APInfo";
  if (source === OTHER_SOURCE_ID) return "Outras fontes";
  return source;
}
