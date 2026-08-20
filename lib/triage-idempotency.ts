import type { AnalysisVersions } from "./analysis-versions";

export function triageIdempotencyKey(userId: string, jobId: string, versions: AnalysisVersions): string {
  return [userId, jobId, versions.profileRevision, versions.rulesRevision, versions.instructionsRevision].join(":");
}

export function canClaimTriageWork(item: { status: "processing" | "completed" | "failed"; leaseUntil: Date | null }, now = new Date()): boolean {
  return item.status !== "completed" && (item.status === "failed" || !item.leaseUntil || item.leaseUntil <= now);
}
