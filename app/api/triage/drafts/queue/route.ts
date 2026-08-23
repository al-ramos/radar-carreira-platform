import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { getDb } from "../../../../../db/index";
import { draftOutbox, jobs, profiles, triageBatches, triageHistory, userJobAnalyses } from "../../../../../db/schema";
import { getAnalysisVersions } from "../../../../../lib/analysis-versions";
import { canonicalizeProfile, profileIsReadyForTriage } from "../../../../../lib/canonical-profile";
import { evaluateDeterministicTriage } from "../../../../../lib/deterministic-triage";
import { isDraftAllowedForSource, isSafeForDraft } from "../../../../../lib/draft-eligibility";
import { requestImmediateDraftCreation, requestImmediateSentReconciliation } from "../../../../../lib/gmail-draft-priority";

function parseStack(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

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

/**
 * Reserva a fila persistente para o futuro criador de rascunhos. Não conversa
 * com Gmail e nunca envia e-mail. O perfil canônico é relido nesta requisição,
 * e somente análises da mesma versão entram na fila.
 */
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });
  const db = getDb();
  const body = await request.json().catch(() => ({})) as DraftQueueRequest;
  if (body.action === "retryFailed") {
    const now = new Date();
    const failed = await db.select({ id: draftOutbox.id }).from(draftOutbox).where(and(eq(draftOutbox.userId, user.userId), eq(draftOutbox.status, "failed")));
    for (const item of failed) await db.update(draftOutbox).set({ status: "pending", error: null, updatedAt: now }).where(eq(draftOutbox.id, item.id));
    return NextResponse.json({ ok: true, retried: failed.length, sent: false });
  }
  if (body.action === "reconcileSent") {
    const requestedJobIds = Array.isArray(body.jobIds) ? [...new Set(body.jobIds.filter((id): id is string => typeof id === "string" && id.length > 0))].slice(0, 200) : [];
    // Sem jobIds: aciona o mesmo conector do Apps Script sob demanda, para
    // todos os rascunhos aguardando confirmação — não é mais preciso
    // escolher vaga por vaga para varrer "Enviados" no Gmail.
    if (!requestedJobIds.length) {
      const pending = await db.select({ id: draftOutbox.id }).from(draftOutbox).where(and(eq(draftOutbox.userId, user.userId), eq(draftOutbox.status, "drafted")));
      if (!pending.length) return NextResponse.json({ ok: true, checked: 0, confirmed: 0 });
      const reconciliation = await requestImmediateSentReconciliation(pending.map((item) => item.id));
      if (!reconciliation.requested) return NextResponse.json({ error: reconciliation.reason ?? "Não foi possível consultar o Gmail agora." }, { status: 503 });
      return NextResponse.json({ ok: true, checked: pending.length, confirmed: reconciliation.confirmed ?? 0 });
    }
    if (requestedJobIds.length === 1) {
      const outbox = await db.select({ id: draftOutbox.id, status: draftOutbox.status }).from(draftOutbox).where(and(eq(draftOutbox.userId, user.userId), eq(draftOutbox.jobId, requestedJobIds[0]))).limit(1).then((rows) => rows[0]);
      if (!outbox) return NextResponse.json({ error: "Rascunho não encontrado para esta vaga." }, { status: 404 });
      if (outbox.status === "sent") return NextResponse.json({ ok: true, alreadySent: true, confirmed: 1 });
      if (outbox.status !== "drafted") return NextResponse.json({ error: "O rascunho ainda não está pronto para conferir o envio." }, { status: 409 });
      const reconciliation = await requestImmediateSentReconciliation([outbox.id]);
      if (!reconciliation.requested) return NextResponse.json({ error: reconciliation.reason ?? "Não foi possível consultar o Gmail agora." }, { status: 503 });
      return NextResponse.json({ ok: true, confirmed: reconciliation.confirmed ?? 0 });
    }
    const outboxItems = await db.select({ id: draftOutbox.id, status: draftOutbox.status }).from(draftOutbox).where(and(eq(draftOutbox.userId, user.userId), inArray(draftOutbox.jobId, requestedJobIds)));
    const drafted = outboxItems.filter((item) => item.status === "drafted");
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
    if (!outbox) return NextResponse.json({ error: "Rascunho não encontrado para esta vaga." }, { status: 404 });
    if (outbox.status === "sent") return NextResponse.json({ ok: true, alreadySent: true, confirmed: 1 });
    if (outbox.status !== "drafted") return NextResponse.json({ error: "Somente um rascunho pronto pode ser confirmado como enviado." }, { status: 409 });
    const now = new Date();
    await db.update(draftOutbox).set({ status: "sent", sentAt: now, error: null, updatedAt: now }).where(and(eq(draftOutbox.id, outbox.id), eq(draftOutbox.userId, user.userId), eq(draftOutbox.status, "drafted")));
    return NextResponse.json({ ok: true, confirmed: 1, manuallyConfirmed: true, sentAt: now });
  }
  const profile = await db.select().from(profiles).where(eq(profiles.userId, user.userId)).limit(1).then((rows) => rows[0]);
  if (!profile) return NextResponse.json({ error: "Complete seu perfil antes de preparar rascunhos." }, { status: 412 });

  const canonicalProfile = canonicalizeProfile(profile);
  if (!profileIsReadyForTriage(canonicalProfile)) return NextResponse.json({ error: "O perfil técnico ainda não está pronto para triagem." }, { status: 412 });
  const sourceId = body.sourceId?.trim();
  const roleArea = body.roleArea?.trim();
  const ingestionChannel = body.ingestionChannel?.trim();
  const homePeriod = body.homePeriod ?? "all";
  const requestedJobIds = Array.isArray(body.jobIds) ? [...new Set(body.jobIds.filter((id): id is string => typeof id === "string" && id.length > 0))].slice(0, 100) : null;
  if (Array.isArray(body.jobIds) && !requestedJobIds?.length) return NextResponse.json({ error: "Selecione ao menos uma vaga válida." }, { status: 400 });
  if (!periods.has(homePeriod)) return NextResponse.json({ error: "Período inválido." }, { status: 400 });
  if (ingestionChannel && ingestionChannel !== "all" && !channels.has(ingestionChannel)) return NextResponse.json({ error: "Canal inválido." }, { status: 400 });
  const cutoff = homePeriod === "all" ? null : new Date(Date.now() - Number(homePeriod) * 36e5);
  const versions = getAnalysisVersions(canonicalProfile);
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
  let repairBatchId: string | null = null;
  const queued: string[] = [];
  const priorityOutboxIds: string[] = [];
  let noValidContact = 0;
  let notEligible = 0;
  let outdated = 0;
  let alreadyPresent = 0;
  for (const row of latestByJob.values()) {
    const existing = existingOutboxByJob.get(row.jobId);
    if (existing) {
      alreadyPresent += 1;
      // Toda preparação é uma ação explícita do portal. Ao usar a fila,
      // também tentamos criar os itens pendentes que já faziam parte dela.
      if (existing.status === "pending") priorityOutboxIds.push(existing.id);
      continue;
    }
    if (!isDraftAllowedForSource({ sourceId: row.job.sourceId, verdict: row.analysis.verdict, contactEmail: row.job.contactEmail })) { notEligible += 1; continue; }
    const analysisIsCurrent = row.analysis
      && row.analysis.profileRevision === versions.profileRevision
      && row.analysis.rulesRevision === versions.rulesRevision
      && row.analysis.instructionsRevision === versions.instructionsRevision;
    if (!analysisIsCurrent) { outdated += 1; continue; }
    const current = evaluateDeterministicTriage({
      title: row.job.title,
      description: row.job.description,
      stack: parseStack(row.job.stack),
      seniority: row.job.seniority,
      workMode: row.job.workMode,
      location: row.job.location,
      publishedAt: row.job.publishedAt,
    }, canonicalProfile);
    if (!isSafeForDraft({
      verdict: row.analysis.verdict,
      blocker: row.analysis.blocker,
      contactEmail: row.job.contactEmail,
      sourceId: row.job.sourceId,
      deterministicVerdict: current.verdict,
      deterministicBlocker: current.blocker,
    })) {
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
    await db.insert(draftOutbox).values({ id: outboxId, userId: user.userId, jobId: row.jobId, historyId, status: "pending", createdAt: now, updatedAt: now });
    queued.push(row.jobId);
    priorityOutboxIds.push(outboxId);
  }

  const individualUnavailableReason = latestByJob.size === 0
    ? "A vaga não possui uma avaliação de triagem utilizável para gerar rascunho."
    : outdated
      ? "A triagem desta vaga está desatualizada; analise-a novamente antes de criar o rascunho."
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
  return NextResponse.json({ ok: true, considered: latestByJob.size, queued: queued.length, queuedJobIds: queued, noValidContact, notEligible, outdated, alreadyPresent, gmailDraftsCreated: immediateDraft.created ?? 0, immediateDraft });
}
