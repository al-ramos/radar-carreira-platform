import { listFromStored, normalizeCareerRules } from "./profile-options";
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

type StoredProfile = {
  masteredSkills: unknown;
  careerRules: unknown;
};

export function analyzeStoredJobForProfile(job: StoredJob, profile: StoredProfile) {
  const masteredSkills = listFromStored(profile.masteredSkills);
  if (!masteredSkills.length) return null;
  const stack = inferTechnologyStack(`${job.title} ${job.description}`, listFromStored(job.stack));
  const verdict = computeVerdict({
    title: job.title,
    description: job.description,
    stack,
    seniority: job.seniority,
    workMode: job.workMode,
    location: job.location,
  }, masteredSkills, normalizeCareerRules(profile.careerRules));
  return {
    verdict,
    stackFit: analyzeStackFit(stack, masteredSkills),
    eligible: verdict.emoji === "✅" || verdict.emoji === "🟡",
  };
}
