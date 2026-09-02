import type { AnalysisVersions } from "./analysis-versions";

export function triageIdempotencyKey(userId: string, jobId: string, versions: AnalysisVersions, inputRevision?: Date | number | string): string {
  const normalizedInputRevision = inputRevision instanceof Date ? inputRevision.getTime() : inputRevision;
  return [userId, jobId, versions.profileRevision, versions.rulesRevision, versions.instructionsRevision, normalizedInputRevision ?? 0].join(":");
}

export function canClaimTriageWork(item: { status: "processing" | "completed" | "failed"; leaseUntil: Date | null }, now = new Date()): boolean {
  return item.status !== "completed" && (item.status === "failed" || !item.leaseUntil || item.leaseUntil <= now);
}
