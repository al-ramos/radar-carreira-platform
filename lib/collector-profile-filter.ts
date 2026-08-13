import { inferTechnologyStack } from "./technology-stack";
import type { ImportedJob } from "./jobs";
import { matchesRequiredStacks, type StackMatchMode } from "./stack-match";

export type CollectorProfile = {
  requiredStacks: string[];
  stackMatchMode: StackMatchMode;
};

export function filterImportedJobsByProfile(items: ImportedJob[], profile: CollectorProfile) {
  const accepted = items.filter((item) => {
    const detected = inferTechnologyStack(`${item.title} ${item.description ?? ""}`, item.stack ?? []);
    return matchesRequiredStacks(detected, profile.requiredStacks, profile.stackMatchMode);
  });
  return {
    accepted,
    rejected: items.length - accepted.length,
    requiredStacks: profile.requiredStacks,
    stackMatchMode: profile.stackMatchMode,
  };
}
