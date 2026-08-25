import type { CanonicalCandidateProfile } from "./canonical-profile";
import { scoreJob } from "./scoring.ts";
import { inferTechnologyStack } from "./technology-stack.ts";
import { analyzeStackFit, computeVerdict, type VerdictResult } from "./verdict.ts";

type JobForTriage = { title: string; description: string; stack: unknown; seniority?: string | null; workMode?: string | null; location?: string | null; publishedAt?: Date | string | null };

export type DeterministicTriage = {
  verdict: "BATE" | "PROVAVEL" | "NAO_BATE";
  blocker: string | null;
  score: number;
  confidence: number;
  matchingSkills: string[];
  missingSkills: string[];
  result: VerdictResult;
};

/** IA só é considerada quando as regras não encontraram bloqueador, mas
 * ainda faltam evidências para uma decisão totalmente determinística. */
export function needsAiRefinement(value: DeterministicTriage) {
  if (value.blocker) return { eligible: false, reason: "bloqueador determinístico" } as const;
  if (value.confidence >= 100) return { eligible: false, reason: "evidências suficientes nas regras" } as const;
  if (value.verdict === "NAO_BATE") return { eligible: false, reason: "não aderente pelas regras" } as const;
  return { eligible: true, reason: "evidências incompletas sem bloqueador" } as const;
}

export function evaluateDeterministicTriage(job: JobForTriage, profile: CanonicalCandidateProfile): DeterministicTriage {
  /*
   * A aprovação precisa ter evidência no texto da própria vaga. Título e
   * tags importadas podem estar desatualizados, ser genéricos ou, em lotes
   * copiados, pertencer visualmente à vaga anterior. Por isso eles não podem
   * provar a stack para a triagem determinística.
   */
  const stack = inferTechnologyStack(job.description);
  const result = computeVerdict({ ...job, stack }, profile.masteredSkills, profile.careerRules);
  const fit = analyzeStackFit(stack, profile.masteredSkills);
  const score = scoreJob({ ...job, stack }, profile).score;
  const knownRows = result.rows.filter(row => row.ok !== null).length;
  const confidence = result.blocker ? 100 : Math.round((knownRows / Math.max(1, result.rows.length)) * 100);
  return {
    verdict: result.emoji === "✅" ? "BATE" : result.emoji === "🟡" ? "PROVAVEL" : "NAO_BATE",
    blocker: result.blocker ?? null, score, confidence, matchingSkills: fit.matchingSkills, missingSkills: fit.missingSkills, result,
  };
}
