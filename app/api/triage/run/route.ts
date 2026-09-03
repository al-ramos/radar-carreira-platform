import { and, asc, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { aiUsageEvents, draftOutbox, jobAiFacts, jobSources, jobs, platformSettings, profiles, triageBatchItems, triageBatches, triageDeduplication, triageHistory, userJobAnalyses } from "../../../../db/schema";
import { getAnalysisVersions } from "../../../../lib/analysis-versions";
import { canonicalizeProfile } from "../../../../lib/canonical-profile";
import { needsCurrentTriage } from "../../../../lib/current-triage";
import { evaluateDeterministicTriage, needsAiRefinement } from "../../../../lib/deterministic-triage";
import { normalizeTriageRunRequest, saoPauloDayWindow, type TriageRunRequest } from "../../../../lib/triage-orchestrator";
import { triageIdempotencyKey } from "../../../../lib/triage-idempotency";
import { isSafeForDraft } from "../../../../lib/draft-eligibility";
import { extractStructuredJobFacts, getAiProviderStatus, validateStructuredJobFacts } from "../../../../lib/ai-provider";
import { normalizeCareerRules } from "../../../../lib/profile-options";
import { applyAiRefinement } from "../../../../lib/triage-ai-refinement";
import { notifyScheduledTriage } from "../../../../lib/notifications";
import { markImmediateDraftFailure, requestImmediateDraftCreation } from "../../../../lib/gmail-draft-priority";

export const dynamic = "force-dynamic";
const AI_FACTS_VERSION = "job-facts-v1";
const RESERVED_OUTPUT_TOKENS = 1200;
const MAX_AI_PER_BATCH = 10;
const DEFAULT_SCHEDULED_TRIAGE_BATCH_SIZE = 100;
const MAX_SCHEDULED_TRIAGE_BATCH_SIZE = 1000;

async function finishQueuedBatch(batchId: string) {
  const db = getDb();
  const rows = await db.select({ status: triageBatchItems.status }).from(triageBatchItems).where(eq(triageBatchItems.batchId, batchId));
  if (rows.some((row) => row.status === "queued" || row.status === "processing")) return;
  const failed = rows.some((row) => row.status === "failed");
  await db.update(triageBatches).set({ status: failed ? "failed" : "completed", completedAt: new Date(), error: failed ? "Uma ou mais vagas falharam; a fila fará novas tentativas antes de encaminhá-las à DLQ." : null }).where(eq(triageBatches.id, batchId));
}

function parseStack(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Executor único do piloto. A origem do disparo muda (portal, agenda ou GPT),
 * mas o contrato, os critérios e a persistência são sempre os mesmos.
 * A IA é usada exclusivamente na faixa ambígua e os rascunhos continuam
 * dependentes de contato válido e de um veredito final seguro.
 */
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  const schedulerAuthenticated = request.headers.get("x-radar-collector-authenticated") === "1";
  const queueAuthenticated = request.headers.get("x-radar-triage-queue-authenticated") === "1";
  const queuedUserId = request.headers.get("x-radar-triage-user-id")?.trim() || null;
  let body: Partial<TriageRunRequest> & { batchId?: string; jobId?: string } = {};
  try {
    body = await request.json() as Partial<TriageRunRequest>;
  } catch {
    // Corpo vazio é válido para o piloto manual.
  }

  let run;
  try {
    run = normalizeTriageRunRequest({
      trigger: body.trigger ?? "portal",
      referenceDate: body.referenceDate,
      sourceId: body.sourceId,
      dateScope: body.dateScope,
      roleArea: body.roleArea,
      ingestionChannel: body.ingestionChannel,
      homePeriod: body.homePeriod,
      batchSize: body.batchSize,
      reprocess: body.reprocess,
      aiMode: body.aiMode ?? "off",
      createDrafts: body.createDrafts ?? false,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Parâmetros inválidos" }, { status: 400 });
  }
  if (schedulerAuthenticated && run.trigger !== "schedule") return NextResponse.json({ error: "A chave de agenda só pode iniciar a rotina agendada." }, { status: 403 });
  if (!schedulerAuthenticated && run.trigger === "schedule") return NextResponse.json({ error: "A rotina agendada só pode ser iniciada pelo backend do Radar." }, { status: 403 });
  if (queueAuthenticated && (!queuedUserId || !body.batchId || !body.jobId || run.trigger !== "portal")) return NextResponse.json({ error: "Mensagem da fila inválida." }, { status: 403 });
  if (run.aiMode === "all") return NextResponse.json({ error: "A IA só pode processar vagas ambíguas; o modo all não é permitido." }, { status: 400 });

  // A rotina interna pode ser disparada por qualquer fonte push. Obtém o
  // dono do perfil a partir da própria fonte, e não de uma fonte fixa.
  const scheduledSource = schedulerAuthenticated
    ? (await getDb().select().from(jobSources).where(eq(jobSources.id, run.sourceId ?? "gmail-radarvagas")).limit(1))[0]
    : null;
  let scheduledUserId: string | null = null;
  try { const config = scheduledSource ? JSON.parse(scheduledSource.externalRef) as { userId?: string } : null; if (config?.userId) scheduledUserId = config.userId; } catch { /* a sessão normal permanece disponível */ }
  // Fontes pull não armazenam usuário em externalRef. O consumidor interno
  // da Queue injeta o dono do Radar depois de autenticar a mensagem.
  if (schedulerAuthenticated) scheduledUserId ??= request.headers.get("x-radar-triage-user-id")?.trim() || null;
  const userId = queueAuthenticated ? queuedUserId : user?.userId ?? scheduledUserId;
  if (!userId) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });

  const db = getDb();
  // A agenda de triagem continua sendo uma opção independente. Já a criação
  // de rascunhos vale para qualquer origem de aprovação (portal, fila, IA ou
  // agenda), sempre sob as regras de segurança abaixo.
  const settings = await db.select({ enabled: platformSettings.scheduledTriageEnabled, batchSize: platformSettings.scheduledTriageBatchSize }).from(platformSettings).where(eq(platformSettings.id, "global")).limit(1).then(rows => rows[0]);
  if (run.trigger === "schedule") {
    // Sem linha de parâmetros, a agenda continua desligada por segurança.
    if (!settings?.enabled) return NextResponse.json({ ok: true, skipped: true, message: "Triagem agendada desligada em Configurações" });
    // O Worker nunca determina a capacidade: ela é um parâmetro operacional
    // persistido e validado no servidor, aplicado também às continuações.
    run = { ...run, batchSize: Math.max(1, Math.min(MAX_SCHEDULED_TRIAGE_BATCH_SIZE, Math.floor(settings?.batchSize ?? DEFAULT_SCHEDULED_TRIAGE_BATCH_SIZE))) };
  }
  const profile = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1).then(rows => rows[0]);
  if (!profile) return NextResponse.json({ error: "Complete seu perfil antes de iniciar a triagem." }, { status: 412 });

  const canonicalProfile = canonicalizeProfile(profile);
  const versions = getAnalysisVersions(canonicalProfile);
  // A ação iniciada pela Home respeita exatamente o período ativo daquele
  // filtro. As demais rotinas continuam usando o dia civil de São Paulo.
  const usesHomePeriod = Boolean(run.homePeriod);
  const scopedToReferenceDay = !usesHomePeriod && (run.trigger === "schedule" || Boolean(run.sourceId) || run.dateScope === "received");
  const dateColumn = run.dateScope === "received" ? jobs.firstSeenAt : jobs.publishedAt;
  const homeCutoff = run.homePeriod && run.homePeriod !== "all" ? new Date(Date.now() - Number(run.homePeriod) * 36e5) : null;
  const queuedBatchId = queueAuthenticated ? body.batchId! : null;
  const queuedJobId = queueAuthenticated ? body.jobId! : null;
  const candidates = await db
    .select({ job: jobs, analysis: userJobAnalyses })
    .from(jobs)
    .leftJoin(userJobAnalyses, and(
      eq(userJobAnalyses.userId, userId),
      eq(userJobAnalyses.jobId, jobs.id),
      eq(userJobAnalyses.profileRevision, versions.profileRevision),
      eq(userJobAnalyses.rulesRevision, versions.rulesRevision),
      eq(userJobAnalyses.instructionsRevision, versions.instructionsRevision),
    ))
    .where(and(
      eq(jobs.status, "active"),
      scopedToReferenceDay ? gte(dateColumn, saoPauloDayWindow(run.referenceDate).start) : undefined,
      scopedToReferenceDay ? lt(dateColumn, saoPauloDayWindow(run.referenceDate).end) : undefined,
      homeCutoff ? gte(jobs.firstSeenAt, homeCutoff) : undefined,
      run.sourceId ? eq(jobs.sourceId, run.sourceId) : undefined,
      run.roleArea ? eq(jobs.roleArea, run.roleArea) : undefined,
      run.ingestionChannel ? eq(jobs.ingestionChannel, run.ingestionChannel) : undefined,
      queuedJobId ? eq(jobs.id, queuedJobId) : undefined,
      run.reprocess ? undefined : needsCurrentTriage(userId, versions),
    ))
    .orderBy(desc(jobs.firstSeenAt), desc(jobs.createdAt))
    .limit(run.batchSize);

  const now = new Date();
  const batchId = queuedBatchId ?? crypto.randomUUID();
  const trigger = run.trigger === "portal" ? "manual" : run.trigger === "schedule" ? "scheduled" : "assistant";
  if (queuedBatchId) {
    await db.update(triageBatches).set({ status: "running", startedAt: now, error: null }).where(and(eq(triageBatches.id, batchId), eq(triageBatches.userId, userId)));
    if (!candidates.length && queuedJobId) {
      await db.update(triageBatchItems).set({ status: "skipped", error: "A vaga já foi triada antes de ser consumida pela fila.", updatedAt: now }).where(and(eq(triageBatchItems.batchId, batchId), eq(triageBatchItems.jobId, queuedJobId)));
      await finishQueuedBatch(batchId);
      return NextResponse.json({ ok: true, batchId, processed: [], skipped: 1, aiEligible: 0, aiCompleted: 0, draftsCreated: 0, aiUsed: false });
    }
  } else {
    await db.insert(triageBatches).values({
      id: batchId, userId, trigger,
      scope: run.sourceId ? (run.homePeriod ? `source-home-period:${run.sourceId}:${run.homePeriod}` : `source-${run.dateScope}-day:${run.sourceId}`) : run.trigger === "schedule" ? (run.homePeriod === "all" ? "schedule-backlog" : "schedule-day") : run.reprocess ? "reprocess" : "unreviewed",
      status: "running", startedAt: now, createdAt: now,
    });
  }

  const processed: Array<{ jobId: string; title: string; company: string; reference: string | null; contactEligible: boolean; aiEligible: boolean; aiStatus: "not_needed" | "cached" | "completed" | "pending" | "failed"; verdict: string; label: string; blocker: string | null }> = [];
  let skipped = 0;
  let aiAttempts = 0;
  let scheduledDraftsQueued = 0;
  try {
    for (const { job, analysis } of candidates) {
      const key = triageIdempotencyKey(userId, job.id, versions);
      const claimed = await db.select().from(triageDeduplication).where(eq(triageDeduplication.idempotencyKey, key)).limit(1).then(rows => rows[0]);
      // A reavaliação é uma solicitação explícita do operador: preserva o
      // histórico aditivo, mas não deixa uma execução normal duplicar o mesmo
      // perfil/vaga/versões.
      const retryAi = run.aiMode === "ambiguous" && analysis?.source === "rules" && analysis.confidence < 100 && !analysis.blocker;
      const reusedHistory = claimed?.historyId
        ? await db.select().from(triageHistory).where(eq(triageHistory.id, claimed.historyId)).limit(1).then(rows => rows[0])
        : null;
      if (claimed?.status === "completed" && !run.reprocess && !retryAi && reusedHistory) {
        skipped += 1;
        // A idempotência barra o reprocessamento, mas o item deste lote
        // precisa refletir o resultado já existente — senão fica "queued"
        // para sempre (nenhum lote futuro vai reprocessar essa vaga) e o
        // lote nunca fecha. Ver incidente do lote 8617af56 (21/08/2026).
        await db.insert(triageBatchItems).values({
          batchId, jobId: job.id, status: "completed", historyId: claimed.historyId, attemptCount: 1, leaseOwner: null, leaseUntil: null, updatedAt: now,
        }).onConflictDoUpdate({
          target: [triageBatchItems.batchId, triageBatchItems.jobId],
          set: { status: "completed", historyId: claimed.historyId, error: null, leaseOwner: null, leaseUntil: null, updatedAt: now },
        });
        // A tela de Histórico lê de user_job_analyses, não de triage_history.
        // Sem este upsert, uma vaga reaproveitada por idempotência fica com
        // veredito salvo mas invisível na tela — mesmo incidente do lote acima.
        const reusedVerdict = evaluateDeterministicTriage({ ...job, stack: parseStack(job.stack) }, canonicalProfile);
        await db.insert(userJobAnalyses).values({
              userId, jobId: job.id, profileVersion: profile.updatedAt, ...versions,
              verdict: reusedHistory.verdict, label: reusedHistory.label, blocker: reusedHistory.blocker, rows: reusedHistory.rows,
              matchingSkills: JSON.stringify(reusedVerdict.matchingSkills), missingSkills: JSON.stringify(reusedVerdict.missingSkills),
              score: reusedVerdict.score,
              source: reusedHistory.source, confidence: reusedHistory.confidence,
              explanation: null, createdAt: now, updatedAt: now,
        }).onConflictDoUpdate({
              target: [userJobAnalyses.userId, userJobAnalyses.jobId],
              set: { profileVersion: profile.updatedAt, ...versions, verdict: reusedHistory.verdict, label: reusedHistory.label, blocker: reusedHistory.blocker, rows: reusedHistory.rows, matchingSkills: JSON.stringify(reusedVerdict.matchingSkills), missingSkills: JSON.stringify(reusedVerdict.missingSkills), score: reusedVerdict.score, source: reusedHistory.source, confidence: reusedHistory.confidence, updatedAt: now },
        });
        continue;
      }
      // A limpeza física anterior pode ter removido o histórico, deixando uma
      // chave "completed" órfã. Ela não representa uma avaliação reutilizável:
      // removemos a trava para avaliar a vaga novamente e repovoar a tela.
      if (claimed?.status === "completed" && !run.reprocess && !retryAi && !reusedHistory) {
        await db.delete(triageDeduplication).where(eq(triageDeduplication.idempotencyKey, key));
      }

      const historyId = crypto.randomUUID();
      const verdict = evaluateDeterministicTriage({ ...job, stack: parseStack(job.stack) }, canonicalProfile);
      const aiRefinement = needsAiRefinement(verdict);
      let finalVerdict = verdict;
      let finalSource: "rules" | "ai" = "rules";
      let explanation: string | null = null;
      let aiStatus: "not_needed" | "cached" | "completed" | "pending" | "failed" = aiRefinement.eligible ? "pending" : "not_needed";
      let rows = JSON.stringify(verdict.result.rows);
      await db.insert(triageDeduplication).values({
        idempotencyKey: key, userId, jobId: job.id, ...versions, status: "processing", leaseOwner: batchId, leaseUntil: new Date(now.getTime() + 5 * 60_000), attemptCount: 1, updatedAt: now,
      }).onConflictDoUpdate({
        target: triageDeduplication.idempotencyKey,
        set: { status: "processing", leaseOwner: batchId, leaseUntil: new Date(now.getTime() + 5 * 60_000), updatedAt: now },
      });
      await db.insert(triageBatchItems).values({ batchId, jobId: job.id, status: "processing", attemptCount: 1, leaseOwner: batchId, leaseUntil: new Date(now.getTime() + 5 * 60_000), updatedAt: now }).onConflictDoUpdate({
        target: [triageBatchItems.batchId, triageBatchItems.jobId],
        set: { status: "processing", error: null, attemptCount: sql`${triageBatchItems.attemptCount} + 1`, leaseOwner: batchId, leaseUntil: new Date(now.getTime() + 5 * 60_000), updatedAt: now },
      });
      await db.insert(triageHistory).values({
        id: historyId, batchId, userId, jobId: job.id, ...versions,
        verdict: verdict.result.emoji, label: verdict.result.label, blocker: verdict.blocker, source: "rules", confidence: verdict.confidence, rows, createdAt: now,
      });
      if (run.aiMode === "ambiguous" && aiRefinement.eligible && aiAttempts < MAX_AI_PER_BATCH) {
        aiAttempts += 1;
        const descriptionHash = createHash("sha256").update(`${job.title}\n${job.company}\n${job.description}`).digest("hex");
        const cached = await db.select().from(jobAiFacts).where(eq(jobAiFacts.jobId, job.id)).limit(1).then(items => items[0]);
        try {
          let facts;
          if (cached?.descriptionHash === descriptionHash && cached.analyzerVersion === AI_FACTS_VERSION) {
            facts = validateStructuredJobFacts(JSON.parse(cached.facts));
            aiStatus = "cached";
          } else {
            const status = getAiProviderStatus();
            if (!status.configured) throw new Error("IA não configurada no ambiente de produção");
            const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
            const rules = normalizeCareerRules(profile.careerRules);
            const usage = await db.select({ total: sql<number>`coalesce(sum(${aiUsageEvents.inputTokens} + ${aiUsageEvents.outputTokens}), 0)` }).from(aiUsageEvents).where(and(eq(aiUsageEvents.userId, userId), gte(aiUsageEvents.createdAt, monthStart))).then(items => Number(items[0]?.total ?? 0));
            const estimatedInput = Math.ceil((job.description.length + job.title.length + job.company.length) / 4);
            if (usage + estimatedInput + RESERVED_OUTPUT_TOKENS > rules.aiMonthlyTokenLimit) {
              await db.insert(aiUsageEvents).values({ id: randomUUID(), userId, jobId: job.id, operation: "resolve_ambiguity", provider: status.provider ?? "unknown", model: status.model ?? "unknown", status: "blocked_budget", createdAt: now });
              throw new Error("Limite mensal de IA atingido");
            }
            const completion = await extractStructuredJobFacts({ title: job.title, company: job.company, location: job.location, url: job.url, description: job.description });
            facts = completion.value; aiStatus = "completed";
            await db.insert(jobAiFacts).values({ jobId: job.id, descriptionHash, analyzerVersion: AI_FACTS_VERSION, facts: JSON.stringify(facts), provider: completion.provider, model: completion.model, inputTokens: completion.inputTokens, outputTokens: completion.outputTokens, analyzedAt: now }).onConflictDoUpdate({ target: jobAiFacts.jobId, set: { descriptionHash, analyzerVersion: AI_FACTS_VERSION, facts: JSON.stringify(facts), provider: completion.provider, model: completion.model, inputTokens: completion.inputTokens, outputTokens: completion.outputTokens, analyzedAt: now } });
            await db.insert(aiUsageEvents).values({ id: randomUUID(), userId, jobId: job.id, operation: "resolve_ambiguity", provider: completion.provider, model: completion.model, inputTokens: completion.inputTokens, outputTokens: completion.outputTokens, status: "completed", createdAt: now });
          }
          const effect = applyAiRefinement(verdict, facts, canonicalProfile.careerRules);
          finalVerdict = { ...verdict, verdict: effect.verdict, blocker: effect.blocker, result: { ...verdict.result, emoji: effect.verdict === "BATE" ? "✅" : effect.verdict === "PROVAVEL" ? "🟡" : "❌", label: effect.label, blocker: effect.blocker } };
          finalSource = "ai";
          explanation = JSON.stringify({ policy: "conservative-v1", effect: effect.effect, reason: effect.reason, facts });
          rows = JSON.stringify({ rules: verdict.result.rows, ai: { effect: effect.effect, reason: effect.reason, evidence: facts.evidence } });
          const refinedHistoryId = crypto.randomUUID();
          await db.insert(triageHistory).values({ id: refinedHistoryId, batchId, userId, jobId: job.id, ...versions, verdict: finalVerdict.result.emoji, label: finalVerdict.result.label, blocker: finalVerdict.blocker, source: "ai", confidence: 100, rows, createdAt: now });
        } catch (error) {
          aiStatus = "failed";
          explanation = JSON.stringify({ policy: "conservative-v1", error: error instanceof Error ? error.message : "Falha ao consultar IA" });
          const status = getAiProviderStatus();
          if (!explanation.includes("Limite mensal")) await db.insert(aiUsageEvents).values({ id: randomUUID(), userId, jobId: job.id, operation: "resolve_ambiguity", provider: status.provider ?? "unknown", model: status.model ?? "unknown", status: "failed", createdAt: now });
        }
      }
      await db.insert(userJobAnalyses).values({
        userId, jobId: job.id, profileVersion: profile.updatedAt, ...versions,
        verdict: finalVerdict.result.emoji, label: finalVerdict.result.label, blocker: finalVerdict.blocker, rows,
        matchingSkills: JSON.stringify(verdict.matchingSkills), missingSkills: JSON.stringify(verdict.missingSkills), source: finalSource, confidence: finalSource === "ai" ? 100 : verdict.confidence,
        score: verdict.score,
        explanation, createdAt: now, updatedAt: now,
      }).onConflictDoUpdate({
        target: [userJobAnalyses.userId, userJobAnalyses.jobId],
        set: { profileVersion: profile.updatedAt, ...versions, verdict: finalVerdict.result.emoji, label: finalVerdict.result.label, blocker: finalVerdict.blocker, rows, matchingSkills: JSON.stringify(verdict.matchingSkills), missingSkills: JSON.stringify(verdict.missingSkills), score: verdict.score, source: finalSource, confidence: finalSource === "ai" ? 100 : verdict.confidence, explanation, updatedAt: now },
      });
      await db.update(triageBatchItems).set({ status: "completed", historyId, leaseOwner: null, leaseUntil: null, updatedAt: now }).where(and(eq(triageBatchItems.batchId, batchId), eq(triageBatchItems.jobId, job.id)));
      await db.update(triageDeduplication).set({ status: "completed", historyId, leaseOwner: null, leaseUntil: null, updatedAt: now }).where(eq(triageDeduplication.idempotencyKey, key));
      // A automação só trata ✅ como aprovação. 🟡 fica no histórico para
      // revisão humana, mesmo que a fila manual ainda aceite esse veredito.
      if (finalVerdict.result.emoji === "✅" && isSafeForDraft({
        verdict: finalVerdict.result.emoji,
        contactEmail: job.contactEmail,
        sourceId: job.sourceId,
      })) {
        const outboxId = crypto.randomUUID();
        const inserted = await db.insert(draftOutbox).values({ id: outboxId, userId, jobId: job.id, historyId, status: "pending", autoSendAuthorized: false, autoSendAuthorizedAt: null, createdAt: now, updatedAt: now }).onConflictDoNothing().returning({ id: draftOutbox.id });
        // onConflictDoNothing + returning só devolve linha quando realmente
        // inseriu (vaga já enfileirada por outra rodada não conta de novo
        // nem entra na chamada ao conector Gmail desta execução).
        if (inserted.length) scheduledDraftsQueued += 1;
      }
      processed.push({ jobId: job.id, title: job.title, company: job.company, reference: job.externalId, contactEligible: Boolean(job.contactEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(job.contactEmail.trim())), aiEligible: aiRefinement.eligible, aiStatus, verdict: finalVerdict.verdict, label: finalVerdict.result.label, blocker: finalVerdict.blocker });
    }
    // Recupera aprovações ✅ já persistidas por CSV, IA ou uma execução
    // anterior que não chegou a criar a outbox. Assim todos os caminhos de
    // aprovação convergem para a mesma automação, sem exigir reimportação ou
    // clique manual.
    if (run.trigger === "schedule") {
      const approvedWithoutOutbox = await db.select({ job: jobs, analysis: userJobAnalyses })
        .from(jobs)
        .innerJoin(userJobAnalyses, and(eq(userJobAnalyses.userId, userId), eq(userJobAnalyses.jobId, jobs.id), eq(userJobAnalyses.verdict, "✅")))
        .leftJoin(draftOutbox, and(eq(draftOutbox.userId, userId), eq(draftOutbox.jobId, jobs.id)))
        .where(and(eq(jobs.status, "active"), isNull(draftOutbox.id)))
        .orderBy(desc(userJobAnalyses.updatedAt))
        .limit(20);
      for (const { job, analysis } of approvedWithoutOutbox) {
        if (!isSafeForDraft({ verdict: analysis.verdict, contactEmail: job.contactEmail, sourceId: job.sourceId })) continue;
        let history = await db.select({ id: triageHistory.id }).from(triageHistory)
          .where(and(eq(triageHistory.userId, userId), eq(triageHistory.jobId, job.id), eq(triageHistory.verdict, "✅")))
          .orderBy(desc(triageHistory.createdAt)).limit(1).then((rows) => rows[0]);
        // Importações antigas e análises avulsas podem ter aprovado a vaga
        // antes de o histórico aditivo existir. A ausência desse vínculo não
        // pode deixar um rascunho elegível fora da automação: reconstituímos
        // a evidência usando a análise persistida e a rodada agendada atual.
        if (!history) {
          history = { id: crypto.randomUUID() };
          await db.insert(triageHistory).values({
            id: history.id, batchId, userId, jobId: job.id,
            profileRevision: analysis.profileRevision, rulesRevision: analysis.rulesRevision, instructionsRevision: analysis.instructionsRevision,
            verdict: "✅", label: analysis.label, blocker: analysis.blocker,
            source: analysis.source as "rules" | "ai", confidence: analysis.confidence, rows: analysis.rows, createdAt: now,
          });
        }
        const inserted = await db.insert(draftOutbox).values({ id: crypto.randomUUID(), userId, jobId: job.id, historyId: history.id, status: "pending", autoSendAuthorized: false, autoSendAuthorizedAt: null, createdAt: now, updatedAt: now }).onConflictDoNothing().returning({ id: draftOutbox.id });
        if (inserted.length) scheduledDraftsQueued += 1;
      }
    }
    if (queuedBatchId) await finishQueuedBatch(batchId);
    else await db.update(triageBatches).set({ status: "completed", completedAt: new Date(), error: null }).where(eq(triageBatches.id, batchId));
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 1000) : "Erro desconhecido";
    if (queuedBatchId && queuedJobId) {
      await db.update(triageBatchItems).set({ status: "failed", error: detail, leaseOwner: null, leaseUntil: null, updatedAt: new Date() }).where(and(eq(triageBatchItems.batchId, batchId), eq(triageBatchItems.jobId, queuedJobId)));
      await finishQueuedBatch(batchId);
    } else await db.update(triageBatches).set({ status: "failed", completedAt: new Date(), error: detail }).where(eq(triageBatches.id, batchId));
    // Etapa 4: falha na rotina agendada é a que menos se percebe sozinha —
    // ninguém está olhando a tela nesse horário. Notificação não pode
    // derrubar a resposta de erro já em curso, por isso fica isolada.
    if (run.trigger === "schedule") await notifyScheduledTriage(db, { batchId, processed: 0, approved: 0, probable: 0, rejected: 0, draftsQueued: 0, error: detail }).catch(() => undefined);
    return NextResponse.json({ error: "Falha no lote; nenhum rascunho foi criado.", batchId, processed, detail }, { status: 500 });
  }

  // Aciona o mesmo conector Gmail que o botão manual usa. Além dos itens
  // incluídos nesta rodada, retoma os que já estavam em "pending": uma
  // indisponibilidade transitória do Apps Script não deixa uma vaga aprovada
  // parada para sempre. O Apps Script relê cada item no endpoint de rascunhos,
  // que revalida perfil, versões e elegibilidade antes de criar qualquer coisa.
  // O limite de 20 preserva o contrato do conector e espalha uma retomada grande
  // pelas próximas rodadas agendadas.
  let immediateDraft: { requested: boolean; created?: number; sent?: number; reason?: string } | null = null;
  const pendingScheduledOutboxIds = await db.select({ id: draftOutbox.id })
      .from(draftOutbox)
      .where(and(eq(draftOutbox.userId, userId), eq(draftOutbox.status, "pending")))
      .orderBy(asc(draftOutbox.createdAt))
      .limit(20)
      .then((rows) => rows.map((row) => row.id));
  if (pendingScheduledOutboxIds.length) {
    try {
      immediateDraft = await requestImmediateDraftCreation(pendingScheduledOutboxIds);
    } catch (error) {
      immediateDraft = { requested: false, reason: error instanceof Error ? error.message : "Falha ao acionar o conector Gmail" };
    }
  }
  if (immediateDraft && !immediateDraft.requested) await markImmediateDraftFailure(pendingScheduledOutboxIds, immediateDraft.reason);

  // Etapa 4: observabilidade da rodada agendada pelo sino já existente, sem
  // painel novo. Silenciosa quando não há nada para relatar (nenhuma vaga
  // nova); falha ao notificar nunca derruba a resposta da triagem.
  if (run.trigger === "schedule") {
    await notifyScheduledTriage(db, {
      batchId,
      processed: processed.length,
      approved: processed.filter(item => item.verdict === "BATE").length,
      probable: processed.filter(item => item.verdict === "PROVAVEL").length,
      rejected: processed.filter(item => item.verdict === "NAO_BATE").length,
      draftsQueued: scheduledDraftsQueued,
      draftsCreated: immediateDraft?.created ?? 0,
      emailsSent: immediateDraft?.sent ?? 0,
      draftsRetried: pendingScheduledOutboxIds.length,
      gmailReason: pendingScheduledOutboxIds.length && !immediateDraft?.requested ? immediateDraft?.reason ?? "conector não confirmou a criação" : null,
    }).catch(() => undefined);
  }

  return NextResponse.json({ ok: true, batchId, referenceDate: run.referenceDate, processed, skipped, hasMore: run.trigger === "schedule" && candidates.length === run.batchSize, aiEligible: processed.filter(item => item.aiEligible).length, aiCompleted: processed.filter(item => item.aiStatus === "completed" || item.aiStatus === "cached").length, draftsCreated: immediateDraft?.created ?? 0, emailsSent: immediateDraft?.sent ?? 0, immediateDraft, aiUsed: processed.some(item => item.aiStatus === "completed" || item.aiStatus === "cached") });
}
