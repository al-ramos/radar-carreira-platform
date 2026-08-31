import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import { getDb } from "../db/index";
import { aiUsageEvents, alertReads, draftOutbox, jobAiFacts, jobAiTriage, jobEvents, jobImportRuns, jobs, triageBatchItems, triageDeduplication, triageHistory, userJobAnalyses, userJobStatus } from "../db/schema";

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

/**
 * Exclusão definitiva do recorte já arquivado. Os comandos são enviados em
 * um único batch D1: ou todas as dependências e as vagas saem, ou nada sai.
 */
export type PurgeableJobStatus = "archived" | "possibly_closed" | "closed";

const effectivePublication = sql`coalesce(${jobs.sourcePublishedAt}, ${jobs.firstSeenAt})`;

function limitedJobIds(status: typeof jobs.$inferSelect.status, cutoff: Date, quantity?: number) {
  const query = getDb().select({ id: jobs.id }).from(jobs).where(and(
    eq(jobs.status, status),
    lt(effectivePublication, cutoff.getTime()),
  )).orderBy(asc(effectivePublication), asc(jobs.id));
  return quantity === undefined ? query : query.limit(quantity);
}

/** Arquiva as vagas ativas mais antigas do recorte sem apagar dependências. */
export async function archiveJobsBeforeCutoff(cutoff: Date, quantity?: number) {
  const db = getDb();
  const count = await db.select({ total: sql<number>`count(*)` }).from(jobs).where(and(
    eq(jobs.status, "active"),
    lt(effectivePublication, cutoff.getTime()),
  ));
  const eligible = Number(count[0]?.total ?? 0);
  const archived = quantity === undefined ? eligible : Math.min(eligible, quantity);
  if (!archived) return 0;
  await db.update(jobs).set({ status: "archived", updatedAt: new Date() }).where(inArray(
    jobs.id,
    limitedJobIds("active", cutoff, quantity),
  ));
  return archived;
}

/** Exclui definitivamente um recorte de vagas que já não está operacional. */
export async function purgeJobsByStatusBeforeCutoff(status: PurgeableJobStatus, cutoff: Date, quantity?: number) {
  const db = getDb();
  const cutoffTime = cutoff.getTime();
  const target = () => limitedJobIds(status, cutoff, quantity);
  const count = await db.select({ total: sql<number>`count(*)` }).from(jobs).where(and(
    eq(jobs.status, status),
    lt(effectivePublication, cutoffTime),
  ));
  const eligible = Number(count[0]?.total ?? 0);
  const deleted = quantity === undefined ? eligible : Math.min(eligible, quantity);
  if (!deleted) return 0;

  const statements = [
    db.delete(draftOutbox).where(inArray(draftOutbox.jobId, target())),
    db.delete(triageDeduplication).where(inArray(triageDeduplication.jobId, target())),
    db.delete(triageBatchItems).where(inArray(triageBatchItems.jobId, target())),
    db.delete(triageHistory).where(inArray(triageHistory.jobId, target())),
    db.delete(alertReads).where(inArray(alertReads.jobId, target())),
    db.delete(userJobStatus).where(inArray(userJobStatus.jobId, target())),
    db.delete(userJobAnalyses).where(inArray(userJobAnalyses.jobId, target())),
    db.delete(jobAiFacts).where(inArray(jobAiFacts.jobId, target())),
    db.delete(jobAiTriage).where(inArray(jobAiTriage.jobId, target())),
    db.delete(aiUsageEvents).where(inArray(aiUsageEvents.jobId, target())),
    db.delete(jobEvents).where(inArray(jobEvents.jobId, target())),
    db.delete(jobImportRuns).where(inArray(jobImportRuns.jobId, target())),
    db.delete(jobs).where(inArray(jobs.id, target())),
  ];
  await db.batch(statements as [typeof statements[number], ...typeof statements[number][]]);
  return deleted;
}

/** Compatibilidade para a limpeza original de vagas arquivadas. */
export async function purgeArchivedJobsBeforeCutoff(cutoff: Date) {
  return purgeJobsByStatusBeforeCutoff("archived", cutoff);
}
