import { inArray } from "drizzle-orm";
import { getDb } from "../db/index";
import { jobImportRuns, jobs } from "../db/schema";

export type IngestionChannel = "extension" | "email" | "connector" | "file" | "api";

export async function recordImportRunJobs(
  db: ReturnType<typeof getDb>,
  runId: string,
  fingerprints: string[],
  existingFingerprints: ReadonlySet<string>,
  receivedAt = new Date(),
) {
  if (!fingerprints.length) return;
  const rows = await db.select({ id: jobs.id, fingerprint: jobs.fingerprint }).from(jobs).where(inArray(jobs.fingerprint, fingerprints));
  const statements = rows.map(row => db.insert(jobImportRuns).values({
    runId,
    jobId: row.id,
    outcome: existingFingerprints.has(row.fingerprint) ? "updated" as const : "inserted" as const,
    receivedAt,
  }).onConflictDoUpdate({
    target: [jobImportRuns.runId, jobImportRuns.jobId],
    set: { outcome: existingFingerprints.has(row.fingerprint) ? "updated" as const : "inserted" as const, receivedAt },
  }));
  if (statements.length) await db.batch(statements as [typeof statements[number], ...typeof statements[number][]]);
}
