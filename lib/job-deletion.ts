import { inArray } from "drizzle-orm";
import { getDb } from "../db/index";
import { aiUsageEvents, alertReads, jobAiFacts, jobEvents, jobImportRuns, jobs, userJobAnalyses, userJobStatus } from "../db/schema";

/** Remove uma vaga e todos os registros que dependem dela, na ordem segura. */
export async function deleteJobsAndRelated(jobIds: string[]) {
  if (!jobIds.length) return 0;
  const db = getDb();
  await db.delete(alertReads).where(inArray(alertReads.jobId, jobIds));
  await db.delete(userJobStatus).where(inArray(userJobStatus.jobId, jobIds));
  await db.delete(userJobAnalyses).where(inArray(userJobAnalyses.jobId, jobIds));
  await db.delete(jobAiFacts).where(inArray(jobAiFacts.jobId, jobIds));
  await db.delete(aiUsageEvents).where(inArray(aiUsageEvents.jobId, jobIds));
  await db.delete(jobEvents).where(inArray(jobEvents.jobId, jobIds));
  await db.delete(jobImportRuns).where(inArray(jobImportRuns.jobId, jobIds));
  await db.delete(jobs).where(inArray(jobs.id, jobIds));
  return jobIds.length;
}
