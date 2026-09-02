import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { automationHeartbeats, draftOutbox, importRuns, jobs, platformSettings, profiles, triageBatchItems, triageBatches, userJobAnalyses } from "../../../../db/schema";
import { isOwnerEmail } from "../../../../lib/access";
import { getAnalysisVersions } from "../../../../lib/analysis-versions";
import { hasTriageableDescription, needsCurrentTriage } from "../../../../lib/current-triage";
import { canonicalizeProfile } from "../../../../lib/canonical-profile";
import { queueUsageForToday } from "../../../../lib/queue-quota";
import { deriveTriageObservability } from "../../../../lib/triage-observability";

export const dynamic = "force-dynamic";

const safeError = (value: string | null) => value
  ?.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[e-mail redigido]")
  .replace(/https?:\/\/\S+/g, "[URL redigida]")
  .replace(/\s+/g, " ").trim().slice(0, 500) ?? null;

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user || !isOwnerEmail(user.email)) return NextResponse.json({ error: "Acesso restrito" }, { status: 403 });

  const db = getDb();
  const compact = new URL(request.url).searchParams.get("compact") === "1";
  if (compact) {
    const settings = await db.select().from(platformSettings).where(eq(platformSettings.id, "global")).limit(1).then((rows) => rows[0]);
    const budget = Math.max(1_000, Math.min(10_000, settings?.queueDailyOperationBudget ?? 7_500));
    const [usage, latestImport, latestTriage, dispatchHeartbeat, recoveryHeartbeat] = await Promise.all([
      queueUsageForToday(db, budget),
      db.select().from(importRuns).orderBy(desc(importRuns.startedAt)).limit(1).then((rows) => rows[0] ?? null),
      db.select().from(triageBatches).where(eq(triageBatches.userId, user.userId)).orderBy(desc(triageBatches.createdAt)).limit(1).then((rows) => rows[0] ?? null),
      db.select().from(automationHeartbeats).where(eq(automationHeartbeats.id, "triage-dispatch")).limit(1).then((rows) => rows[0] ?? null),
      db.select().from(automationHeartbeats).where(eq(automationHeartbeats.id, "triage-recovery")).limit(1).then((rows) => rows[0] ?? null),
    ]);
    const failures = [
      dispatchHeartbeat?.status === "failed" ? { error: safeError(dispatchHeartbeat.error), at: dispatchHeartbeat.updatedAt } : null,
      recoveryHeartbeat?.status === "failed" ? { error: safeError(recoveryHeartbeat.error), at: recoveryHeartbeat.updatedAt } : null,
      latestTriage?.status === "failed" ? { error: safeError(latestTriage.error), at: latestTriage.completedAt ?? latestTriage.startedAt ?? latestTriage.createdAt } : null,
      latestImport?.status === "failed" ? { error: `Importação ${latestImport.source}: falha registrada.`, at: latestImport.finishedAt ?? latestImport.startedAt } : null,
    ].filter((item): item is { error: string | null; at: Date } => Boolean(item?.at))
      .sort((left, right) => right.at.getTime() - left.at.getTime());
    const failure = failures[0] ?? null;
    return NextResponse.json({
      ...usage,
      ...deriveTriageObservability({ budget, reservedOperations: usage.reservedOperations, retryOperations: usage.retryOperations, resetAt: usage.resetAt, scheduledEnabled: settings?.scheduledTriageEnabled ?? false, failure }),
      hardLimit: 10_000,
      scheduledEnabled: settings?.scheduledTriageEnabled ?? false,
      failure,
      compact: true,
    }, { headers: { "Cache-Control": "private, no-store" } });
  }
  const [settings, profile] = await Promise.all([
    db.select().from(platformSettings).where(eq(platformSettings.id, "global")).limit(1).then((rows) => rows[0]),
    db.select().from(profiles).where(eq(profiles.userId, user.userId)).limit(1).then((rows) => rows[0]),
  ]);
  if (!profile) return NextResponse.json({ error: "Complete seu perfil antes de consultar a triagem." }, { status: 412 });

  const versions = getAnalysisVersions(canonicalizeProfile(profile));
  const budget = Math.max(1_000, Math.min(10_000, settings?.queueDailyOperationBudget ?? 7_500));
  const pendingCurrentVersion = needsCurrentTriage(user.userId, versions);
  const descriptionReady = hasTriageableDescription();

  const [usage, latestImport, latestTriage, dispatchHeartbeat, recoveryHeartbeat, activeSummary, verdictRows, draftRows] = await Promise.all([
    queueUsageForToday(db, budget),
    db.select().from(importRuns).orderBy(desc(importRuns.startedAt)).limit(1).then((rows) => rows[0] ?? null),
    db.select().from(triageBatches).where(eq(triageBatches.userId, user.userId)).orderBy(desc(triageBatches.createdAt)).limit(1).then((rows) => rows[0] ?? null),
    db.select().from(automationHeartbeats).where(eq(automationHeartbeats.id, "triage-dispatch")).limit(1).then((rows) => rows[0] ?? null),
    db.select().from(automationHeartbeats).where(eq(automationHeartbeats.id, "triage-recovery")).limit(1).then((rows) => rows[0] ?? null),
    db.select({
      total: count(),
      pending: sql<number>`sum(case when ${descriptionReady} and ${pendingCurrentVersion} then 1 else 0 end)`,
      missingDescription: sql<number>`sum(case when not (${descriptionReady}) then 1 else 0 end)`,
    }).from(jobs).where(eq(jobs.status, "active")).then((rows) => rows[0]),
    db.select({ verdict: userJobAnalyses.verdict, total: count() })
      .from(userJobAnalyses)
      .innerJoin(jobs, and(eq(jobs.id, userJobAnalyses.jobId), eq(jobs.status, "active")))
      .where(and(
        descriptionReady,
        eq(userJobAnalyses.userId, user.userId),
        eq(userJobAnalyses.profileRevision, versions.profileRevision),
        eq(userJobAnalyses.rulesRevision, versions.rulesRevision),
        eq(userJobAnalyses.instructionsRevision, versions.instructionsRevision),
        gte(userJobAnalyses.updatedAt, jobs.triageInputUpdatedAt),
      )).groupBy(userJobAnalyses.verdict),
    db.select({ status: draftOutbox.status, total: count() }).from(draftOutbox)
      .where(eq(draftOutbox.userId, user.userId)).groupBy(draftOutbox.status),
  ]);

  const triageTotals = latestTriage
    ? await db.select({
      total: count(),
      completed: sql<number>`sum(case when ${triageBatchItems.status} = 'completed' then 1 else 0 end)`,
      failed: sql<number>`sum(case when ${triageBatchItems.status} = 'failed' then 1 else 0 end)`,
    }).from(triageBatchItems).where(eq(triageBatchItems.batchId, latestTriage.id)).then((rows) => rows[0])
    : { total: 0, completed: 0, failed: 0 };

  const failures = [
    dispatchHeartbeat?.status === "failed" ? { error: safeError(dispatchHeartbeat.error), at: dispatchHeartbeat.updatedAt } : null,
    recoveryHeartbeat?.status === "failed" ? { error: safeError(recoveryHeartbeat.error), at: recoveryHeartbeat.updatedAt } : null,
    latestTriage?.status === "failed" ? { error: safeError(latestTriage.error), at: latestTriage.completedAt ?? latestTriage.startedAt ?? latestTriage.createdAt } : null,
    latestImport?.status === "failed" ? { error: `Importação ${latestImport.source}: falha registrada.`, at: latestImport.finishedAt ?? latestImport.startedAt } : null,
  ].filter((item): item is { error: string | null; at: Date } => Boolean(item?.at))
    .sort((left, right) => right.at.getTime() - left.at.getTime());
  const failure = failures[0] ?? null;
  const health = deriveTriageObservability({
    budget,
    reservedOperations: usage.reservedOperations,
    retryOperations: usage.retryOperations,
    resetAt: usage.resetAt,
    scheduledEnabled: settings?.scheduledTriageEnabled ?? false,
    failure,
  });
  const verdictTotal = (verdict: string) => Number(verdictRows.find((row) => row.verdict === verdict)?.total ?? 0);
  const draftTotal = (status: string) => Number(draftRows.find((row) => row.status === status)?.total ?? 0);

  return NextResponse.json({
    ...usage,
    ...health,
    hardLimit: 10_000,
    scheduledEnabled: settings?.scheduledTriageEnabled ?? false,
    pending: Number(activeSummary?.pending ?? 0),
    missingDescription: Number(activeSummary?.missingDescription ?? 0),
    activeJobs: Number(activeSummary?.total ?? 0),
    currentVerdicts: {
      approved: verdictTotal("✅"), probable: verdictTotal("🟡"),
      rejected: verdictTotal("❌") + verdictTotal("🔴"),
    },
    drafts: { pending: draftTotal("pending"), ready: draftTotal("drafted"), failed: draftTotal("failed"), sent: draftTotal("sent") },
    lastImport: latestImport ? {
      id: latestImport.id, source: latestImport.source, status: latestImport.status,
      startedAt: latestImport.startedAt, completedAt: latestImport.finishedAt,
      received: latestImport.received, inserted: latestImport.inserted, updated: latestImport.updated, errors: latestImport.errors,
    } : null,
    lastTriage: latestTriage ? {
      id: latestTriage.id, trigger: latestTriage.trigger, status: latestTriage.status,
      startedAt: latestTriage.startedAt ?? latestTriage.createdAt, completedAt: latestTriage.completedAt,
      error: safeError(latestTriage.error), total: Number(triageTotals.total ?? 0),
      completed: Number(triageTotals.completed ?? 0), failed: Number(triageTotals.failed ?? 0),
    } : null,
    failure,
  });
}
