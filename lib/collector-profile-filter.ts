import { inferTechnologyStack } from "./technology-stack";
import type { ImportedJob } from "./jobs";
import { matchesRequiredStacks, type StackMatchMode } from "./stack-match";

export type CollectorProfile = {
  requiredStacks: string[];
  stackMatchMode: StackMatchMode;
};

export type ProfileRejectedJob = Pick<ImportedJob, "externalId" | "title" | "company"> & {
  reason: string;
};

export function filterImportedJobsByProfile(items: ImportedJob[], profile: CollectorProfile) {
  const accepted: ImportedJob[] = [];
  const rejectedJobs: ProfileRejectedJob[] = [];
  const reason = profile.requiredStacks.length
    ? `Não atende ${profile.stackMatchMode === "all" ? "todas as" : "nenhuma das"} stacks obrigatórias do perfil.`
    : "Não atende ao perfil obrigatório.";

  for (const item of items) {
    const detected = inferTechnologyStack(`${item.title} ${item.description ?? ""}`, item.stack ?? []);
    if (matchesRequiredStacks(detected, profile.requiredStacks, profile.stackMatchMode)) accepted.push(item);
    else rejectedJobs.push({ externalId: item.externalId, title: item.title, company: item.company, reason });
  }

  return {
    accepted,
    rejected: rejectedJobs.length,
    rejectedJobs,
    requiredStacks: profile.requiredStacks,
    stackMatchMode: profile.stackMatchMode,
  };
}
