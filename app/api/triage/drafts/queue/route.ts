import { and, desc, eq, gte, inArray, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { getDb } from "../../../../../db/index";
import { draftOutbox, jobs, triageBatches, triageHistory, userJobAnalyses, userJobStatus } from "../../../../../db/schema";
import { normalizeContactEmail } from "../../../../../lib/contact-email";
import { isSafeForDraft } from "../../../../../lib/draft-eligibility";
import { markImmediateDraftFailure, requestImmediateDraftCreation, requestImmediateSentReconciliation } from "../../../../../lib/gmail-draft-priority";
import { resolveAutomaticStage } from "../../../../../lib/pipeline-stage";

export const dynamic = "force-dynamic";

const periods = new Set(["24", "72", "168", "all"]);
const channels = new Set(["extension", "email", "connector", "file", "api"]);
type DraftQueueRequest = {
  action?: "queue" | "retryFailed" | "reconcileSent" | "confirmSent";
  sourceId?: string;
  roleArea?: string;
  ingestionChannel?: string;
  homePeriod?: string;
  jobIds?: string[];
};

async function recordApplicationSent(userId: string, jobId: string, sentAt: Date) {
  const db = getDb();
  const existing = await db.select().from(userJobStatus)
    .where(and(eq(userJobStatus.userId, userId), eq(userJobStatus.jobId, jobId)))
    .limit(1).then((rows) => rows[0]);
  const applicationStatus = existing?.applicationStatus === "responded" ? "responded" as const : "sent" as const;
  const values = {
    userId,
    jobId,
    stage: resolveAutomaticStage(existing?.stage, "applied"),
    note: existing?.note ?? "Envio confirmado no acompanhamento do Gmail.",
    applicationStatus,
    generatedAt: existing?.generatedAt ?? sentAt,
    sentAt: existing?.sentAt ?? sentAt,
    respondedAt: existing?.respondedAt ?? null,
    updatedAt: new Date(),
  };
  await db.insert(userJobStatus).values(values).onConflictDoUpdate({
    target: [userJobStatus.userId, userJobStatus.jobId],
    set: { stage: values.stage, note: values.note, applicationStatus: values.applicationStatus, generatedAt: values.generatedAt, sentAt: values.sentAt, respondedAt: values.respondedAt, updatedAt: values.updatedAt },
  });
}

/**
 * Reserva a fila persistente e aciona a criação e o envio imediato da
 * candidatura aprovada para o e-mail validado.
 */
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });
  const db = getDb();
  const body = await request.json().catch(() => ({})) as DraftQueueRequest;
  if (body.action === "retryFailed") {
    const now = new Date();
    const failed = await db.select({ id: draftOutbox.id }).from(draftOutbox).where(and(eq(draftOutbox.userId, user.userId), eq(draftOutbox.status, "failed")));
    for (const item of failed) await db.update(draftOutbox).set({ status: "pending", autoSendAuthorized: true, autoSendAuthorizedAt: now, error: null, updatedAt: now }).where(eq(draftOutbox.id, item.id));
    const immediateDraft = failed.length ? await requestImmediateDraftCreation(failed.map((item) => item.id)) : { requested: false };
    if (!immediateDraft.requested) await markImmediateDraftFailure(failed.map((item) => item.id), immediateDraft.reason);
    return NextResponse.json({ ok: true, retried: failed.length, emailsSent: immediateDraft.sent ?? 0, immediateDraft });
  }
  if (body.action === "reconcileSent") {
    const requestedJobIds = Array.isArray(body.jobIds) ? [...new Set(body.jobIds.filter((id): id is string => typeof id === "string" && id.length > 0))].slice(0, 200) : [];
    // Sem jobIds: aciona o mesmo conector do Apps Script sob demanda, para
    // todos os rascunhos aguardando confirmação — não é mais preciso
    // escolher vaga por vaga para varrer "Enviados" no Gmail.
    if (!requestedJobIds.length) {
      const pending = await db.select({ id: draftOutbox.id }).from(draftOutbox).where(and(eq(draftOutbox.userId, user.userId), or(eq(draftOutbox.status, "drafted"), eq(draftOutbox.status, "checking"))));
      if (!pending.length) return NextResponse.json({ ok: true, checked: 0, confirmed: 0 });
      const reconciliation = await requestImmediateSentReconciliation(pending.map((item) => item.id));
      if (!reconciliation.requested) return NextResponse.json({ error: reconciliation.reason ?? "Não foi possível consultar o Gmail agora." }, { status: 503 });
      return NextResponse.json({ ok: true, checked: pending.length, confirmed: reconciliation.confirmed ?? 0 });
    }
    if (requestedJobIds.length === 1) {
      let outbox = await db.select({ id: draftOutbox.id, status: draftOutbox.status }).from(draftOutbox).where(and(eq(draftOutbox.userId, user.userId), eq(draftOutbox.jobId, requestedJobIds[0]))).limit(1).then((rows) => rows[0]);
      if (!outbox) {
        const row = await db.select({ historyId: triageHistory.id, job: jobs, analysis: userJobAnalyses })
          .from(userJobAnalyses)
          .innerJoin(jobs, eq(userJobAnalyses.jobId, jobs.id))
          .leftJoin(triageHistory, and(eq(triageHistory.userId, user.userId), eq(triageHistory.jobId, jobs.id)))
          .where(and(eq(userJobAnalyses.userId, user.userId), eq(userJobAnalyses.jobId, requestedJobIds[0])))
          .orderBy(desc(triageHistory.createdAt)).limit(1).then((rows) => rows[0]);
        if (!row) return NextResponse.json({ error: "A vaga não possui análise vinculada para conferir o envio." }, { status: 404 });
        if (!normalizeContactEmail(row.job.contactEmail)) return NextResponse.json({ error: "A vaga não possui e-mail válido para conferir o envio." }, { status: 409 });
        let historyId = row.historyId;
        if (!historyId) {
          const now = new Date();
          const batchId = crypto.randomUUID();
          historyId = crypto.randomUUID();
          await db.insert(triageBatches).values({ id: batchId, userId: user.userId, trigger: "manual", scope: "sent-history-repair", status: "completed", startedAt: now, completedAt: now, createdAt: now });
          await db.insert(triageHistory).values({ id: historyId, batchId, userId: user.userId, jobId: row.job.id, profileRevision: row.analysis.profileRevision, rulesRevision: row.analysis.rulesRevision, instructionsRevision: row.analysis.instructionsRevision, verdict: row.analysis.verdict, label: row.analysis.label, blocker: row.analysis.blocker, source: row.analysis.source, confidence: row.analysis.confidence, rows: row.analysis.rows, createdAt: now });
        }
        const now = new Date();
        const outboxId = crypto.randomUUID();
        await db.insert(draftOutbox).values({ id: outboxId, userId: user.userId, jobId: row.job.id, historyId, status: "checking", autoSendAuthorized: false, autoSendAuthorizedAt: null, createdAt: now, updatedAt: now });
        outbox = { id: outboxId, status: "checking" };
      }
      if (outbox.status === "sent") return NextResponse.json({ ok: true, alreadySent: true, confirmed: 1 });
      if (outbox.status === "failed" || outbox.status === "cancelled") {
        await db.update(draftOutbox).set({ status: "checking", autoSendAuthorized: false, autoSendAuthorizedAt: null, error: null, updatedAt: new Date() }).where(eq(draftOutbox.id, outbox.id));
      }
      const reconciliation = await requestImmediateSentReconciliation([outbox.id]);
      if (!reconciliation.requested) return NextResponse.json({ error: reconciliation.reason ?? "Não foi possível consultar o Gmail agora." }, { status: 503 });
      return NextResponse.json({ ok: true, confirmed: reconciliation.confirmed ?? 0 });
    }
    const outboxItems = await db.select({ id: draftOutbox.id, status: draftOutbox.status }).from(draftOutbox).where(and(eq(draftOutbox.userId, user.userId), inArray(draftOutbox.jobId, requestedJobIds)));
    const drafted = outboxItems.filter((item) => item.status === "drafted" || item.status === "checking");
    if (!drafted.length) return NextResponse.json({ ok: true, checked: 0, confirmed: 0 });
    const reconciliation = await requestImmediateSentReconciliation(drafted.map((item) => item.id));
    if (!reconciliation.requested) return NextResponse.json({ error: reconciliation.reason ?? "Não foi possível consultar o Gmail agora." }, { status: 503 });
    return NextResponse.json({ ok: true, checked: drafted.length, confirmed: reconciliation.confirmed ?? 0 });
  }
  // Alternativa explícita para o caso em que a ponte com o Gmail esteja
  // indisponível. Não envia e-mail: apenas registra a confirmação feita pela
  // própria pessoa usuária, que já enviou a mensagem fora do Radar.
  if (body.action === "confirmSent") {
    const requestedJobIds = Array.isArray(body.jobIds) ? [...new Set(body.jobIds.filter((id): id is string => typeof id === "string" && id.length > 0))].slice(0, 2) : [];
    if (requestedJobIds.length !== 1) return NextResponse.json({ error: "Escolha uma única vaga para confirmar o envio." }, { status: 400 });
    const outbox = await db.select({ id: draftOutbox.id, status: draftOutbox.status }).from(draftOutbox).where(and(eq(draftOutbox.userId, user.userId), eq(draftOutbox.jobId, requestedJobIds[0]))).limit(1).then((rows) => rows[0]);
    if (!outbox) return NextResponse.json({ error: "Registro de acompanhamento não encontrado para esta vaga. Use Verificar envio primeiro." }, { status: 404 });
    if (outbox.status === "sent") return NextResponse.json({ ok: true, alreadySent: true, confirmed: 1 });
    if (!["drafted", "checking", "cancelled", "failed"].includes(outbox.status)) return NextResponse.json({ error: "O acompanhamento ainda está sendo preparado; tente novamente em instantes." }, { status: 409 });
    const now = new Date();
    await db.update(draftOutbox).set({ status: "sent", sentAt: now, error: null, updatedAt: now }).where(and(eq(draftOutbox.id, outbox.id), eq(draftOutbox.userId, user.userId)));
    await recordApplicationSent(user.userId, requestedJobIds[0], now);
    return NextResponse.json({ ok: true, confirmed: 1, manuallyConfirmed: true, sentAt: now });
  }
  const sourceId = body.sourceId?.trim();
  const roleArea = body.roleArea?.trim();
  const ingestionChannel = body.ingestionChannel?.trim();
  const homePeriod = body.homePeriod ?? "all";
  const requestedJobIds = Array.isArray(body.jobIds) ? [...new Set(body.jobIds.filter((id): id is string => typeof id === "string" && id.length > 0))].slice(0, 100) : null;
  if (Array.isArray(body.jobIds) && !requestedJobIds?.length) return NextResponse.json({ error: "Selecione ao menos uma vaga válida." }, { status: 400 });
  if (!periods.has(homePeriod)) return NextResponse.json({ error: "Período inválido." }, { status: 400 });
  if (ingestionChannel && ingestionChannel !== "all" && !channels.has(ingestionChannel)) return NextResponse.json({ error: "Canal inválido." }, { status: 400 });
  const cutoff = homePeriod === "all" ? null : new Date(Date.now() - Number(homePeriod) * 36e5);
  const [historyRows, existingOutbox] = await Promise.all([
    db.select({
      historyId: triageHistory.id,
      historyCreatedAt: triageHistory.createdAt,
      jobId: userJobAnalyses.jobId,
      job: jobs,
      analysis: userJobAnalyses,
    })
      .from(userJobAnalyses)
      .innerJoin(jobs, eq(userJobAnalyses.jobId, jobs.id))
      .leftJoin(triageHistory, and(eq(triageHistory.userId, user.userId), eq(triageHistory.jobId, jobs.id)))
      .where(and(
        eq(userJobAnalyses.userId, user.userId),
        eq(jobs.status, "active"),
        requestedJobIds ? inArray(userJobAnalyses.jobId, requestedJobIds) : undefined,
        // Fonte/área/canal/período são recortes do painel de lote e não fazem
        // sentido quando vagas específicas foram pedidas (ação de uma linha ou
        // seleção manual): aplicá-los ali excluía vagas fora do recorte
        // corrente mesmo com avaliação válida, e o rascunho falhava com
        // "vaga não possui avaliação de triagem utilizável" mesmo existindo uma.
        !requestedJobIds && sourceId && sourceId !== "all" ? eq(jobs.sourceId, sourceId) : undefined,
        !requestedJobIds && roleArea && roleArea !== "all" ? eq(jobs.roleArea, roleArea) : undefined,
        !requestedJobIds && ingestionChannel && ingestionChannel !== "all" ? eq(jobs.ingestionChannel, ingestionChannel as "extension" | "email" | "connector" | "file" | "api") : undefined,
        !requestedJobIds && cutoff ? gte(jobs.firstSeenAt, cutoff) : undefined,
      ))
      .orderBy(desc(triageHistory.createdAt)),
    db.select({ id: draftOutbox.id, jobId: draftOutbox.jobId, status: draftOutbox.status }).from(draftOutbox).where(eq(draftOutbox.userId, user.userId)),
  ]);

  const existingOutboxByJob = new Map(existingOutbox.map((row) => [row.jobId, row]));
  const latestByJob = new Map<string, typeof historyRows[number]>();
  for (const row of historyRows) if (!latestByJob.has(row.jobId)) latestByJob.set(row.jobId, row);

  const now = new Date();
  const authorizeAutomaticSend = body.action === "queue";
  let repairBatchId: string | null = null;
  const queued: string[] = [];
  const priorityOutboxIds: string[] = [];
  let noValidContact = 0;
  let notEligible = 0;
  const outdated = 0;
  let alreadyPresent = 0;
  for (const row of latestByJob.values()) {
    const existing = existingOutboxByJob.get(row.jobId);
    if (existing) {
      // Itens cancelados pela política anterior (por exemplo, análise marcada
      // como desatualizada) voltam à fila assim que a vaga continua ✅ e tem
      // e-mail válido. A outbox permanece idempotente: só o status é retomado.
      if (existing.status === "failed" || existing.status === "cancelled") {
        if (!isSafeForDraft({ verdict: row.analysis.verdict, contactEmail: row.job.contactEmail, sourceId: row.job.sourceId })) {
          if (!row.job.contactEmail?.trim()) noValidContact += 1;
          else notEligible += 1;
          continue;
        }
        await db.update(draftOutbox).set({ status: "pending", autoSendAuthorized: authorizeAutomaticSend, autoSendAuthorizedAt: authorizeAutomaticSend ? now : null, error: null, updatedAt: now }).where(eq(draftOutbox.id, existing.id));
        priorityOutboxIds.push(existing.id);
        continue;
      }
      alreadyPresent += 1;
      if (existing.status === "pending") {
        if (authorizeAutomaticSend) await db.update(draftOutbox).set({ autoSendAuthorized: true, autoSendAuthorizedAt: now, updatedAt: now }).where(eq(draftOutbox.id, existing.id));
        priorityOutboxIds.push(existing.id);
      } else if (existing.status === "drafted" && authorizeAutomaticSend) {
        // Um rascunho automático não autoriza envio. Esta ação explícita do
        // portal devolve o item à fila com autorização individual.
        await db.update(draftOutbox).set({ status: "pending", autoSendAuthorized: true, autoSendAuthorizedAt: now, error: null, updatedAt: now }).where(eq(draftOutbox.id, existing.id));
        priorityOutboxIds.push(existing.id);
      }
      continue;
    }
    if (!isSafeForDraft({ verdict: row.analysis.verdict, contactEmail: row.job.contactEmail, sourceId: row.job.sourceId })) {
      if (!row.job.contactEmail?.trim()) noValidContact += 1;
      else notEligible += 1;
      continue;
    }
    let historyId = row.historyId;
    if (!historyId) {
      if (!repairBatchId) {
        repairBatchId = crypto.randomUUID();
        await db.insert(triageBatches).values({ id: repairBatchId, userId: user.userId, trigger: "manual", scope: "draft-history-repair", status: "completed", startedAt: now, completedAt: now, createdAt: now });
      }
      historyId = crypto.randomUUID();
      await db.insert(triageHistory).values({ id: historyId, batchId: repairBatchId, userId: user.userId, jobId: row.jobId, profileRevision: row.analysis.profileRevision, rulesRevision: row.analysis.rulesRevision, instructionsRevision: row.analysis.instructionsRevision, verdict: row.analysis.verdict as "✅" | "🟡" | "🔴" | "❌", label: row.analysis.label, blocker: row.analysis.blocker, source: row.analysis.source as "rules" | "ai", confidence: row.analysis.confidence, rows: row.analysis.rows, createdAt: now });
    }
    const outboxId = crypto.randomUUID();
    await db.insert(draftOutbox).values({ id: outboxId, userId: user.userId, jobId: row.jobId, historyId, status: "pending", autoSendAuthorized: authorizeAutomaticSend, autoSendAuthorizedAt: authorizeAutomaticSend ? now : null, createdAt: now, updatedAt: now });
    queued.push(row.jobId);
    priorityOutboxIds.push(outboxId);
  }

  const individualUnavailableReason = latestByJob.size === 0
    ? "A vaga não possui uma avaliação de triagem utilizável para gerar rascunho."
    : noValidContact
        ? "A vaga não tem e-mail de contato válido."
        : notEligible
          ? "As regras atuais de segurança não permitem criar rascunho para esta vaga."
          : alreadyPresent
            ? "Já existe um rascunho ou item de fila para esta vaga; atualize a tela para ver o status."
            : "A vaga não está disponível para criação manual.";
  const immediateDraft = priorityOutboxIds.length
    ? await requestImmediateDraftCreation(priorityOutboxIds)
    : { requested: false, reason: requestedJobIds?.length === 1 ? individualUnavailableReason : "Nenhum rascunho pendente está disponível neste recorte." };
  if (priorityOutboxIds.length && !immediateDraft.requested) await markImmediateDraftFailure(priorityOutboxIds, immediateDraft.reason);
  return NextResponse.json({ ok: true, considered: latestByJob.size, queued: queued.length, queuedJobIds: queued, noValidContact, notEligible, outdated, alreadyPresent, gmailDraftsCreated: immediateDraft.created ?? 0, emailsSent: immediateDraft.sent ?? 0, emailsReconciled: immediateDraft.reconciled ?? 0, immediateDraft });
}
