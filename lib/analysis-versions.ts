import type { CanonicalCandidateProfile } from "./canonical-profile";

/** Bump somente quando a semântica determinística da triagem mudar. */
export const TRIAGE_RULES_VERSION = "rules-v1";
/** Bump somente quando o contrato/prompt da avaliação por IA mudar. */
export const TRIAGE_AI_INSTRUCTIONS_VERSION = "ai-instructions-v1";

export type AnalysisVersions = {
  profileRevision: string;
  rulesRevision: string;
  instructionsRevision: string;
};

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).sort().join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableValue(item)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** FNV-1a 32 bits: suficiente para chave de invalidação, sem API externa. */
function fingerprint(value: unknown): string {
  let hash = 0x811c9dc5;
  for (const character of stableValue(value)) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function getAnalysisVersions(profile: CanonicalCandidateProfile): AnalysisVersions {
  const { userId: _userId, version: _version, careerRules, ...profileChoices } = profile;
  return {
    profileRevision: `profile-${fingerprint(profileChoices)}`,
    rulesRevision: `${TRIAGE_RULES_VERSION}-${fingerprint(careerRules)}`,
    instructionsRevision: TRIAGE_AI_INSTRUCTIONS_VERSION,
  };
}

export function analysisVersionsMatch(left: AnalysisVersions, right: AnalysisVersions): boolean {
  return left.profileRevision === right.profileRevision
    && left.rulesRevision === right.rulesRevision
    && left.instructionsRevision === right.instructionsRevision;
}
