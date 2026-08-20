import { and, desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { draftOutbox, jobs, triageBatchItems, triageBatches, triageHistory } from "../../../../db/schema";
import { hasValidContactEmail } from "../../../../lib/contact-email";

export const dynamic = "force-dynamic";

/** Histórico pessoal e persistente da nova triagem. Nunca consulta resultados
 * de outro usuário e não cria rascunhos nem altera vagas. */
export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });

  const items = await getDb()
    .select({
      id: triageHistory.id,
      batchId: triageHistory.batchId,
      verdict: triageHistory.verdict,
      label: triageHistory.label,
      blocker: triageHistory.blocker,
      source: triageHistory.source,
      confidence: triageHistory.confidence,
      rows: triageHistory.rows,
      processedAt: triageHistory.createdAt,
      title: jobs.title,
      company: jobs.company,
      jobId: jobs.id,
      externalId: jobs.externalId,
      jobSource: jobs.sourceId,
      workMode: jobs.workMode,
      location: jobs.location,
      sourcePublishedAt: jobs.sourcePublishedAt,
      receivedAt: jobs.firstSeenAt,
      url: jobs.url,
      contactEmail: jobs.contactEmail,
      contactSubject: jobs.contactSubject,
      draftStatus: draftOutbox.status,
      draftError: draftOutbox.error,
      draftUpdatedAt: draftOutbox.updatedAt,
      trigger: triageBatches.trigger,
    })
    .from(triageHistory)
    .innerJoin(jobs, eq(triageHistory.jobId, jobs.id))
    .innerJoin(triageBatches, eq(triageHistory.batchId, triageBatches.id))
    .leftJoin(draftOutbox, and(eq(draftOutbox.historyId, triageHistory.id), eq(draftOutbox.userId, user.userId)))
    .where(eq(triageHistory.userId, user.userId))
    .orderBy(desc(triageHistory.createdAt))
    .limit(100);

  const db = getDb();
  const batches = await db.select({
    id: triageBatches.id,
    trigger: triageBatches.trigger,
    scope: triageBatches.scope,
    status: triageBatches.status,
    startedAt: triageBatches.startedAt,
    completedAt: triageBatches.completedAt,
    error: triageBatches.error,
    createdAt: triageBatches.createdAt,
  }).from(triageBatches)
    .where(eq(triageBatches.userId, user.userId))
    .orderBy(desc(triageBatches.createdAt))
    .limit(8);
  const batchIds = batches.map((batch) => batch.id);
  const batchItems = batchIds.length
    ? await db.select({ batchId: triageBatchItems.batchId, historyId: triageBatchItems.historyId, status: triageBatchItems.status })
      .from(triageBatchItems).where(inArray(triageBatchItems.batchId, batchIds))
    : [];
  const historyIds = batchItems.flatMap((item) => item.historyId ? [item.historyId] : []);
  const batchHistory = batchIds.length
    ? await db.select({ batchId: triageHistory.batchId, verdict: triageHistory.verdict, contactEmail: jobs.contactEmail })
      .from(triageHistory).innerJoin(jobs, eq(triageHistory.jobId, jobs.id))
      .where(and(eq(triageHistory.userId, user.userId), inArray(triageHistory.batchId, batchIds)))
    : [];
  const outboxItems = historyIds.length
    ? await db.select({ historyId: draftOutbox.historyId, status: draftOutbox.status })
      .from(draftOutbox).where(and(eq(draftOutbox.userId, user.userId), inArray(draftOutbox.historyId, historyIds)))
    : [];
  const outboxByHistoryId = new Map(outboxItems.map((item) => [item.historyId, item.status]));
  const allOutbox = await db.select({ status: draftOutbox.status, createdAt: draftOutbox.createdAt })
    .from(draftOutbox).where(eq(draftOutbox.userId, user.userId));
  const latestScheduledBatch = batches.find((batch) => batch.trigger === "scheduled");
  const now = Date.now();
  const oldestPending = allOutbox.filter((item) => item.status === "pending").sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
  const alerts = [
    ...(allOutbox.some((item) => item.status === "failed") ? [{ level: "error", message: `${allOutbox.filter((item) => item.status === "failed").length} rascunho(s) com falha aguardam retomada.` }] : []),
    ...(oldestPending && now - oldestPending.createdAt.getTime() > 24 * 60 * 60 * 1000 ? [{ level: "warning", message: "Há rascunhos pendentes há mais de 24 horas." }] : []),
    ...(!latestScheduledBatch ? [{ level: "warning", message: "A rotina diária ainda não registrou nenhuma execução." }] : []),
    ...(latestScheduledBatch && latestScheduledBatch.status === "failed" ? [{ level: "error", message: "A última rotina diária falhou; consulte o detalhe do lote." }] : []),
    ...(latestScheduledBatch && now - (latestScheduledBatch.completedAt ?? latestScheduledBatch.startedAt ?? latestScheduledBatch.createdAt).getTime() > 30 * 60 * 60 * 1000 ? [{ level: "warning", message: "A rotina diária está sem atualização há mais de 30 horas." }] : []),
  ];

  return NextResponse.json({
    items: items.map((item) => ({
      ...item,
      hasValidContactEmail: hasValidContactEmail(item.contactEmail),
      draftSubject: item.contactSubject?.trim() || `Candidatura — ${item.title}${item.externalId ? ` (vaga ${item.externalId})` : ""}`,
    })),
    batches: batches.map((batch) => {
      const batchRows = batchItems.filter((item) => item.batchId === batch.id);
      const assessed = batchHistory.filter((item) => item.batchId === batch.id);
      const eligible = assessed.filter((item) => item.verdict === "✅" || item.verdict === "🟡");
      const drafts = batchRows.flatMap((item) => {
        const status = item.historyId ? outboxByHistoryId.get(item.historyId) : null;
        return status ? [status] : [];
      });
      return {
        ...batch,
        total: batchRows.length,
        completed: batchRows.filter((item) => item.status === "completed").length,
        failed: batchRows.filter((item) => item.status === "failed").length,
        eligible: eligible.length,
        eligibleWithoutContact: eligible.filter((item) => !hasValidContactEmail(item.contactEmail)).length,
        draftsPending: drafts.filter((status) => status === "pending").length,
        draftsReady: drafts.filter((status) => status === "drafted").length,
        draftsFailed: drafts.filter((status) => status === "failed").length,
      };
    }),
    operational: {
      pendingDrafts: allOutbox.filter((item) => item.status === "pending").length,
      readyDrafts: allOutbox.filter((item) => item.status === "drafted").length,
      failedDrafts: allOutbox.filter((item) => item.status === "failed").length,
      oldestPendingAt: oldestPending?.createdAt ?? null,
      alerts,
    },
  });
}
