import { allowedWorkModes, listFromStored, normalizeCareerRules, normalizeMinScore, type CareerRules } from "./profile-options.ts";

/**
 * Dados mínimos da tabela `profiles` necessários para decidir a aderência.
 * A tabela D1 é a única fonte de verdade em execução; presets servem somente
 * para o primeiro preenchimento da interface e nunca para a triagem.
 */
export type StoredCandidateProfile = {
  userId: string;
  seniority: unknown;
  preferredMode: unknown;
  masteredSkills: unknown;
  desiredAreas: unknown;
  avoidTerms: unknown;
  minScore: unknown;
  careerRules: unknown;
  updatedAt: Date;
};

export type CanonicalCandidateProfile = {
  userId: string;
  version: Date;
  seniority: string[];
  preferredMode: string[];
  masteredSkills: string[];
  desiredAreas: string[];
  avoidTerms: string[];
  minScore: number;
  careerRules: CareerRules;
};

/**
 * Normaliza o registro persistido antes de qualquer avaliação. Não completa a
 * stack com valores fixos: sem competências cadastradas, a vaga deve aguardar
 * o preenchimento do perfil, em vez de receber um veredito presumido.
 */
export function canonicalizeProfile(profile: StoredCandidateProfile): CanonicalCandidateProfile {
  return {
    userId: profile.userId,
    version: profile.updatedAt,
    seniority: listFromStored(profile.seniority),
    preferredMode: allowedWorkModes(profile.preferredMode),
    masteredSkills: listFromStored(profile.masteredSkills),
    desiredAreas: listFromStored(profile.desiredAreas),
    avoidTerms: listFromStored(profile.avoidTerms),
    minScore: normalizeMinScore(profile.minScore),
    careerRules: normalizeCareerRules(profile.careerRules),
  };
}

export function profileIsReadyForTriage(profile: CanonicalCandidateProfile): boolean {
  return profile.masteredSkills.length > 0;
}
