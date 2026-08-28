import { and, desc, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { draftOutbox, jobs, jobSources, triageBatchItems, triageBatches, triageHistory, userJobAnalyses, userJobStatus } from "../../../../db/schema";
import { isOwnerEmail } from "../../../../lib/access";
import { hasValidContactEmail } from "../../../../lib/contact-email";
import { saoPauloDayWindow } from "../../../../lib/triage-orchestrator";

export const dynamic = "force-dynamic";

const OPERATIONAL_MESSAGES = {
  staleDrafts: "Há rascunhos pendentes há mais de 24 horas.",
  staleSchedule: "A triagem automática não executa há mais de 30 horas. Verifique a automação diária.",
};

const STALE_DRAFT_AFTER_MS = 24 * 60 * 60 * 1000;
const STALE_SCHEDULE_AFTER_MS = 30 * 60 * 60 * 1000;

/**
 * A análise pessoal preserva a avaliação aplicada ao perfil, inclusive as
 * vagas APInfo consultadas antes da triagem diária. Lotes e outbox são lidos
 * em paralelo para que o card operacional reflita o estado persistido.
 */
export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });
  if (!isOwnerEmail(user.email)) {
    return NextResponse.json({ error: "Acesso restrito ao proprietário" }, { status: 403 });
  }

  const db = getDb();
  const query = new URL(request.url).searchParams;
  const scope = query.get("scope");
  const pendingScope = scope === "pending";
  const code = query.get("code")?.trim().slice(0, 100) ?? "";
  const codeScope = scope === "code" && Boolean(code);
  // user_job_analyses contém cálculos antigos de aderência que não representam
  // uma triagem. O histórico aditivo é a evidência de avaliação concluída.
  const hasAuditableTriage = sql<number>`exists (
    select 1 from ${triageHistory}
    where ${triageHistory.userId} = ${user.userId}
      and ${triageHistory.jobId} = ${jobs.id}
  )`;
  const pendingTriageCondition = sql`not exists (
    select 1 from ${triageHistory}
    where ${triageHistory.userId} = ${user.userId}
      and ${triageHistory.jobId} = ${jobs.id}
  )`;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const todayWindow = saoPauloDayWindow(today);
  const items = await db
    .select({
      id: jobs.id,
      jobId: jobs.id,
      verdict: userJobAnalyses.verdict,
      label: userJobAnalyses.label,
      blocker: userJobAnalyses.blocker,
      source: userJobAnalyses.source,
      confidence: userJobAnalyses.confidence,
      rows: userJobAnalyses.rows,
      explanation: userJobAnalyses.explanation,
      processedAt: userJobAnalyses.updatedAt,
      title: jobs.title,
      company: jobs.company,
      externalId: jobs.externalId,
      description: jobs.description,
      stack: jobs.stack,
      jobSource: jobs.sourceId,
      jobSourceName: jobSources.name,
      workMode: jobs.workMode,
      location: jobs.location,
      sourcePublishedAt: jobs.sourcePublishedAt,
      publishedAt: jobs.publishedAt,
      receivedAt: jobs.firstSeenAt,
      url: jobs.url,
      applyUrl: jobs.applyUrl,
      contactEmail: jobs.contactEmail,
      contactSubject: jobs.contactSubject,
      draftStatus: draftOutbox.status,
      draftError: draftOutbox.error,
      draftUpdatedAt: draftOutbox.updatedAt,
      gmailSentId: draftOutbox.gmailSentId,
      sentAt: draftOutbox.sentAt,
      applicationStatus: userJobStatus.applicationStatus,
      pipelineStage: userJobStatus.stage,
      triaged: hasAuditableTriage,
    })
    // O Histórico também é a fila de trabalho. Começar por `jobs` preserva
    // as vagas que ainda não têm análise, permitindo que “Não analisadas” e
    // “Todas” mostrem o estoque real em vez de uma tabela vazia.
    .from(jobs)
    .leftJoin(userJobAnalyses, and(eq(userJobAnalyses.userId, user.userId), eq(userJobAnalyses.jobId, jobs.id)))
    .leftJoin(jobSources, eq(jobs.sourceId, jobSources.id))
    .leftJoin(draftOutbox, and(eq(draftOutbox.userId, user.userId), eq(draftOutbox.jobId, jobs.id)))
    .leftJoin(userJobStatus, and(eq(userJobStatus.userId, user.userId), eq(userJobStatus.jobId, jobs.id)))
    // A visão padrão é operacional e mostra somente o acervo ativo. Já o
    // filtro “Não analisadas” precisa ser fiel ao seu nome: ele também traz
    // vagas encerradas ou arquivadas que ficaram sem veredito, sem carregar
    // todo o acervo inativo nas demais visões.
    .where(codeScope
      // A busca por código é uma consulta pontual: ela deve localizar a vaga
      // mesmo depois de encerrada ou arquivada, sem carregar todo o acervo
      // inativo na tabela.
      ? sql`instr(lower(coalesce(${jobs.externalId}, '')), lower(${code})) > 0`
      : pendingScope
        ? pendingTriageCondition
        : eq(jobs.status, "active"))
    // O resumo e os filtros do Histórico precisam cobrir todo o acervo
    // ativo. Um limite aqui fazia o painel estacionar artificialmente em
    // 1.000, mesmo quando havia mais vagas analisadas.
    .orderBy(desc(userJobAnalyses.updatedAt), desc(jobs.firstSeenAt));

  const [batchRows, batchItemRows, outboxRows, batchDraftRows, batchHistoryRows, repairableRows, todayReceived] = await Promise.all([
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
    db.select({
      batchId: triageBatchItems.batchId, jobId: triageBatchItems.jobId, status: triageBatchItems.status,
      error: triageBatchItems.error, attemptCount: triageBatchItems.attemptCount, updatedAt: triageBatchItems.updatedAt,
      leaseUntil: triageBatchItems.leaseUntil, title: jobs.title, company: jobs.company, externalId: jobs.externalId,
    }).from(triageBatchItems)
      .innerJoin(triageBatches, eq(triageBatchItems.batchId, triageBatches.id))
      .innerJoin(jobs, eq(triageBatchItems.jobId, jobs.id))
      .where(eq(triageBatches.userId, user.userId)),
    db.select({ status: draftOutbox.status, createdAt: draftOutbox.createdAt, sentAt: draftOutbox.sentAt }).from(draftOutbox).where(eq(draftOutbox.userId, user.userId)),
    db.select({ batchId: triageHistory.batchId, status: draftOutbox.status }).from(draftOutbox)
      .innerJoin(triageHistory, eq(draftOutbox.historyId, triageHistory.id))
      .where(eq(draftOutbox.userId, user.userId)),
    db.select({ batchId: triageHistory.batchId, verdict: triageHistory.verdict, contactEmail: jobs.contactEmail }).from(triageHistory)
      .innerJoin(jobs, eq(triageHistory.jobId, jobs.id))
      .where(eq(triageHistory.userId, user.userId)),
    db.select({ jobId: triageHistory.jobId }).from(triageHistory)
      .innerJoin(triageBatchItems, and(eq(triageBatchItems.batchId, triageHistory.batchId), eq(triageBatchItems.jobId, triageHistory.jobId), eq(triageBatchItems.status, "completed")))
      .leftJoin(userJobAnalyses, and(eq(userJobAnalyses.userId, user.userId), eq(userJobAnalyses.jobId, triageHistory.jobId)))
      .where(and(eq(triageHistory.userId, user.userId), isNull(userJobAnalyses.jobId))),
    db.select({ total: sql<number>`count(*)` }).from(jobs).where(and(eq(jobs.status, "active"), gte(jobs.firstSeenAt, todayWindow.start), lt(jobs.firstSeenAt, todayWindow.end))).then((rows) => Number(rows[0]?.total ?? 0)),
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
  const sentDrafts = outboxRows.filter((row) => row.status === "sent");
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
      // O detalhe persistido explica o veredito na mesma linha da tabela.
      label: item.explanation?.trim() ? `${item.label} · ${item.explanation.trim()}` : item.label,
      // Importações anteriores à coluna `source_published_at` ainda possuem a
      // data de publicação em `published_at`. Sem esse fallback, a consulta
      // APInfo do dia perde vagas que foram efetivamente publicadas hoje.
      sourcePublishedAt: item.sourcePublishedAt ?? item.publishedAt,
      label: item.label ?? "Aguardando triagem",
      source: item.source ?? "pending",
      triaged: Boolean(item.triaged),
      confidence: item.confidence ?? 0,
      rows: item.rows ?? "[]",
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
    // Diário operacional persistido: explica espera, tentativa, erro e a
    // última alteração sem depender de logs efêmeros da Queue.
    batchItems: batchItemRows,
    recovery: { available: new Set(repairableRows.map((row) => row.jobId)).size },
    operational: {
      pendingDrafts: pendingDrafts.length,
      readyDrafts: readyDrafts.length,
      sentDrafts: sentDrafts.length,
      failedDrafts: failedDrafts.length,
      oldestPendingAt,
      alerts,
      messages: OPERATIONAL_MESSAGES,
    },
    todayReceived,
  });
}
