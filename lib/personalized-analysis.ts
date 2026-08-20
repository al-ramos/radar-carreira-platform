import { canonicalizeProfile, profileIsReadyForTriage, type StoredCandidateProfile } from "./canonical-profile";
import { listFromStored } from "./profile-options";
import { inferTechnologyStack } from "./technology-stack";
import { analyzeStackFit, computeVerdict } from "./verdict";

type StoredJob = {
  title: string;
  description: string;
  stack: unknown;
  seniority?: string | null;
  workMode?: string | null;
  location?: string | null;
};

export function analyzeStoredJobForProfile(job: StoredJob, storedProfile: StoredCandidateProfile) {
  const profile = canonicalizeProfile(storedProfile);
  if (!profileIsReadyForTriage(profile)) return null;
  const stack = inferTechnologyStack(`${job.title} ${job.description}`, listFromStored(job.stack));
  const verdict = computeVerdict({
    title: job.title,
    description: job.description,
    stack,
    seniority: job.seniority,
    workMode: job.workMode,
    location: job.location,
  }, profile.masteredSkills, profile.careerRules);
  return {
    verdict,
    stackFit: analyzeStackFit(stack, profile.masteredSkills),
    eligible: verdict.emoji === "✅" || verdict.emoji === "🟡",
  };
}
