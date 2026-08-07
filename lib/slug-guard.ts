import { CURATED_SOURCES, QUARANTINED_SOURCES } from "./curated-sources";

const GENERIC_SLUGS = new Set([
  "jobs", "work", "team", "corp", "inc", "ltd", "co", "sa", "br", "us", "eu",
]);

/**
 * Retorna as razões pelas quais um slug é considerado suspeito.
 * Lista vazia = slug limpo.
 */
export function slugGuardReasons(slug: string): string[] {
  const s = slug.toLowerCase().trim();
  const reasons: string[] = [];

  if (s.length <= 4) {
    reasons.push(`Slug muito curto (${s.length} caracteres) — tende a ser genérico em plataformas ATS`);
  }

  if (GENERIC_SLUGS.has(s)) {
    reasons.push(`"${s}" é palavra genérica comum em URLs de carreira`);
  }

  const inQuarantine = QUARANTINED_SOURCES.find(q => q.externalRef === s);
  const inCurated = CURATED_SOURCES.find(c => c.externalRef === s);

  if (inQuarantine) {
    reasons.push(`Colisão registrada na quarentena como "${inQuarantine.name}"`);
  }
  if (inCurated) {
    reasons.push(`Slug já ativo no catálogo como "${inCurated.name}"`);
  }

  return reasons;
}

/**
 * Retorna true se o slug é suspeito e precisa de revisão manual.
 */
export function isAmbiguousSlug(slug: string): boolean {
  return slugGuardReasons(slug).length > 0;
}
