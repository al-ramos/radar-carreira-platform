import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { draftOutbox, jobs, triageBatchItems, triageBatches, triageHistory, userJobAnalyses } from "../../../../db/schema";
import { isOwnerEmail } from "../../../../lib/access";
import { hasValidContactEmail } from "../../../../lib/contact-email";

export const dynamic = "force-dynamic";

const OPERATIONAL_MESSAGES = {
  staleDrafts: "Há rascunhos pendentes há mais de 24 horas.",
  staleSchedule: "A rotina diária está sem atualização há mais de 30 horas.",
};

const STALE_DRAFT_AFTER_MS = 24 * 60 * 60 * 1000;
const STALE_SCHEDULE_AFTER_MS = 30 * 60 * 60 * 1000;

/**
 * A análise pessoal preserva a avaliação aplicada ao perfil, inclusive as
 * vagas APInfo consultadas antes da triagem diária. Lotes e outbox são lidos
 * em paralelo para que o card operacional reflita o estado persistido.
 */
export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });
  if (!isOwnerEmail(user.email)) {
    return NextResponse.json({ error: "Acesso restrito ao proprietário" }, { status: 403 });
  }

  const db = getDb();
  const items = await db
    .select({
      id: userJobAnalyses.jobId,
      jobId: userJobAnalyses.jobId,
      verdict: userJobAnalyses.verdict,
      label: userJobAnalyses.label,
      blocker: userJobAnalyses.blocker,
      source: userJobAnalyses.source,
      confidence: userJobAnalyses.confidence,
      rows: userJobAnalyses.rows,
      processedAt: userJobAnalyses.updatedAt,
      title: jobs.title,
      company: jobs.company,
      externalId: jobs.externalId,
      jobSource: jobs.sourceId,
      workMode: jobs.workMode,
      location: jobs.location,
      sourcePublishedAt: jobs.sourcePublishedAt,
      publishedAt: jobs.publishedAt,
      receivedAt: jobs.firstSeenAt,
      url: jobs.url,
      contactEmail: jobs.contactEmail,
      contactSubject: jobs.contactSubject,
      draftStatus: draftOutbox.status,
      draftError: draftOutbox.error,
      draftUpdatedAt: draftOutbox.updatedAt,
    })
    .from(userJobAnalyses)
    .innerJoin(jobs, eq(userJobAnalyses.jobId, jobs.id))
    .leftJoin(draftOutbox, and(eq(draftOutbox.userId, user.userId), eq(draftOutbox.jobId, jobs.id)))
    .where(eq(userJobAnalyses.userId, user.userId))
    .orderBy(desc(userJobAnalyses.updatedAt))
    .limit(1000);

  const [batchRows, batchItemRows, outboxRows, batchDraftRows, batchHistoryRows] = await Promise.all([
    db.select({
      id: triageBatches.id,
      trigger: triageBatches.trigger,
      scope: triageBatches.scope,
      status: triageBatches.status,
      startedAt: triageBatches.startedAt,
      completedAt: triageBatches.completedAt,
      createdAt: triageBatches.createdAt,
      error: triageBatches.error,
    }).from(triageBatches).where(eq(triageBatches.userId, user.userId)).orderBy(desc(triageBatches.createdAt)).limit(30),
    db.select({ batchId: triageBatchItems.batchId, status: triageBatchItems.status }).from(triageBatchItems)
      .innerJoin(triageBatches, eq(triageBatchItems.batchId, triageBatches.id))
      .where(eq(triageBatches.userId, user.userId)),
    db.select({ status: draftOutbox.status, createdAt: draftOutbox.createdAt }).from(draftOutbox).where(eq(draftOutbox.userId, user.userId)),
    db.select({ batchId: triageHistory.batchId, status: draftOutbox.status }).from(draftOutbox)
      .innerJoin(triageHistory, eq(draftOutbox.historyId, triageHistory.id))
      .where(eq(draftOutbox.userId, user.userId)),
    db.select({ batchId: triageHistory.batchId, verdict: triageHistory.verdict, contactEmail: jobs.contactEmail }).from(triageHistory)
      .innerJoin(jobs, eq(triageHistory.jobId, jobs.id))
      .where(eq(triageHistory.userId, user.userId)),
  ]);

  const itemSummary = new Map<string, { total: number; completed: number; failed: number }>();
  for (const item of batchItemRows) {
    const summary = itemSummary.get(item.batchId) ?? { total: 0, completed: 0, failed: 0 };
    summary.total += 1;
    if (item.status === "completed") summary.completed += 1;
    if (item.status === "failed") summary.failed += 1;
    itemSummary.set(item.batchId, summary);
  }
  const draftSummary = new Map<string, { pending: number; ready: number; failed: number }>();
  for (const draft of batchDraftRows) {
    const summary = draftSummary.get(draft.batchId) ?? { pending: 0, ready: 0, failed: 0 };
    if (draft.status === "pending") summary.pending += 1;
    if (draft.status === "drafted") summary.ready += 1;
    if (draft.status === "failed") summary.failed += 1;
    draftSummary.set(draft.batchId, summary);
  }

  const now = Date.now();
  const pendingDrafts = outboxRows.filter((row) => row.status === "pending");
  const readyDrafts = outboxRows.filter((row) => row.status === "drafted");
  const failedDrafts = outboxRows.filter((row) => row.status === "failed");
  const oldestPendingAt = pendingDrafts.reduce<Date | null>((oldest, row) => !oldest || row.createdAt < oldest ? row.createdAt : oldest, null);
  const latestScheduled = batchRows.find((batch) => batch.trigger === "scheduled");
  const alerts: Array<{ level: "warning" | "error"; message: string }> = [];
  if (oldestPendingAt && now - oldestPendingAt.getTime() > STALE_DRAFT_AFTER_MS) alerts.push({ level: "warning", message: OPERATIONAL_MESSAGES.staleDrafts });
  const scheduledAt = latestScheduled?.completedAt ?? latestScheduled?.startedAt ?? latestScheduled?.createdAt;
  if (!scheduledAt || now - scheduledAt.getTime() > STALE_SCHEDULE_AFTER_MS) alerts.push({ level: "error", message: OPERATIONAL_MESSAGES.staleSchedule });

  return NextResponse.json({
    items: items.map((item) => ({
      ...item,
      // Importações anteriores à coluna `source_published_at` ainda possuem a
      // data de publicação em `published_at`. Sem esse fallback, a consulta
      // APInfo do dia perde vagas que foram efetivamente publicadas hoje.
      sourcePublishedAt: item.sourcePublishedAt ?? item.publishedAt,
      batchId: "profile-analysis",
      draftSubject: item.contactSubject?.trim() || `Candidatura — ${item.title}${item.externalId ? ` (vaga ${item.externalId})` : ""}`,
      trigger: "scheduled",
      hasValidContactEmail: hasValidContactEmail(item.contactEmail),
    })),
    batches: batchRows.map((batch) => {
      const itemCount = itemSummary.get(batch.id) ?? { total: 0, completed: 0, failed: 0 };
      const drafts = draftSummary.get(batch.id) ?? { pending: 0, ready: 0, failed: 0 };
      const eligible = batchHistoryRows.filter((item) => item.batchId === batch.id && (item.verdict === "✅" || item.verdict === "🟡"));
      return {
        ...batch,
        ...itemCount,
        eligible: eligible.length,
        eligibleWithoutContact: eligible.filter((item) => !hasValidContactEmail(item.contactEmail)).length,
        draftsPending: drafts.pending,
        draftsReady: drafts.ready,
        draftsFailed: drafts.failed,
      };
    }),
    operational: {
      pendingDrafts: pendingDrafts.length,
      readyDrafts: readyDrafts.length,
      failedDrafts: failedDrafts.length,
      oldestPendingAt,
      alerts,
      messages: OPERATIONAL_MESSAGES,
    },
  });
}
