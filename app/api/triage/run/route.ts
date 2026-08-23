import { and, desc, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { aiUsageEvents, draftOutbox, jobAiFacts, jobSources, jobs, platformSettings, profiles, triageBatchItems, triageBatches, triageDeduplication, triageHistory, userJobAnalyses } from "../../../../db/schema";
import { getAnalysisVersions } from "../../../../lib/analysis-versions";
import { canonicalizeProfile } from "../../../../lib/canonical-profile";
import { evaluateDeterministicTriage, needsAiRefinement } from "../../../../lib/deterministic-triage";
import { normalizeTriageRunRequest, saoPauloDayWindow, type TriageRunRequest } from "../../../../lib/triage-orchestrator";
import { triageIdempotencyKey } from "../../../../lib/triage-idempotency";
import { isSafeForDraft } from "../../../../lib/draft-eligibility";
import { requestImmediateDraftCreation } from "../../../../lib/gmail-draft-priority";
import { notifyScheduledTriage } from "../../../../lib/notifications";
import { extractStructuredJobFacts, getAiProviderStatus, validateStructuredJobFacts } from "../../../../lib/ai-provider";
import { normalizeCareerRules } from "../../../../lib/profile-options";
import { applyAiRefinement } from "../../../../lib/triage-ai-refinement";

export const dynamic = "force-dynamic";
const AI_FACTS_VERSION = "job-facts-v1";
const RESERVED_OUTPUT_TOKENS = 1200;
const MAX_AI_PER_BATCH = 10;

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
  const source = schedulerAuthenticated ? (await getDb().select().from(jobSources).where(eq(jobSources.id, "gmail-radarvagas")).limit(1))[0] : null;
  let scheduledUserId: string | null = null;
  try { const config = source ? JSON.parse(source.externalRef) as { userId?: string } : null; if (config?.userId) scheduledUserId = config.userId; } catch { /* a sessão normal permanece disponível */ }
  const userId = queueAuthenticated ? queuedUserId : user?.userId ?? scheduledUserId;
  if (!userId) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });

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

  const db = getDb();
  // Etapa 1 da automação ponta a ponta: a rotina agendada só roda com o
  // interruptor ligado em Configurações, e só enfileira rascunho se o
  // segundo interruptor (mais restritivo) também estiver ligado. Ambos
  // desligados por padrão até serem validados; evita reprocessar tudo ou
  // enfileirar rascunhos silenciosamente se alguém ligar a agenda antes de
  // revisar o comportamento.
  let scheduledDraftQueueEnabled = false;
  let scheduledAutoCreateEnabled = false;
  if (run.trigger === "schedule") {
    const settings = await db.select({ enabled: platformSettings.scheduledTriageEnabled, draftQueueEnabled: platformSettings.scheduledTriageDraftQueueEnabled, autoCreateEnabled: platformSettings.scheduledTriageAutoCreateEnabled }).from(platformSettings).where(eq(platformSettings.id, "global")).limit(1).then(rows => rows[0]);
    // Sem linha em platform_settings, o padrão é desligado (mesma postura do
    // schema): nunca inferir "ligado" por ausência de configuração.
    if (!settings?.enabled) return NextResponse.json({ ok: true, skipped: true, message: "Triagem agendada desligada em Configurações" });
    scheduledDraftQueueEnabled = settings.draftQueueEnabled;
    // Etapa 3: criar de verdade no Gmail exige a fila ligada também — nunca
    // aciona o conector sozinho, mesmo que alguém ligue só este interruptor
    // (a UI já trava isso, mas a rota não confia só na UI).
    scheduledAutoCreateEnabled = settings.draftQueueEnabled && settings.autoCreateEnabled;
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
    .leftJoin(userJobAnalyses, and(eq(userJobAnalyses.userId, userId), eq(userJobAnalyses.jobId, jobs.id)))
    .where(and(
      eq(jobs.status, "active"),
      scopedToReferenceDay ? gte(dateColumn, saoPauloDayWindow(run.referenceDate).start) : undefined,
      scopedToReferenceDay ? lt(dateColumn, saoPauloDayWindow(run.referenceDate).end) : undefined,
      homeCutoff ? gte(jobs.firstSeenAt, homeCutoff) : undefined,
      run.sourceId ? eq(jobs.sourceId, run.sourceId) : undefined,
      run.roleArea ? eq(jobs.roleArea, run.roleArea) : undefined,
      run.ingestionChannel ? eq(jobs.ingestionChannel, run.ingestionChannel) : undefined,
      queuedJobId ? eq(jobs.id, queuedJobId) : undefined,
      run.reprocess ? undefined : run.aiMode === "ambiguous"
        ? or(isNull(userJobAnalyses.jobId), and(eq(userJobAnalyses.source, "rules"), lt(userJobAnalyses.confidence, 100), isNull(userJobAnalyses.blocker)))
        : isNull(userJobAnalyses.jobId),
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
      scope: run.sourceId ? (run.homePeriod ? `source-home-period:${run.sourceId}:${run.homePeriod}` : `source-${run.dateScope}-day:${run.sourceId}`) : run.trigger === "schedule" ? "schedule-day" : run.reprocess ? "reprocess" : "unreviewed",
      status: "running", startedAt: now, createdAt: now,
    });
  }

  const processed: Array<{ jobId: string; title: string; company: string; reference: string | null; contactEligible: boolean; aiEligible: boolean; aiStatus: "not_needed" | "cached" | "completed" | "pending" | "failed"; verdict: string; label: string; blocker: string | null }> = [];
  let skipped = 0;
  let aiAttempts = 0;
  const scheduledOutboxIds: string[] = [];
  try {
    for (const { job, analysis } of candidates) {
      const key = triageIdempotencyKey(userId, job.id, versions);
      const claimed = await db.select().from(triageDeduplication).where(eq(triageDeduplication.idempotencyKey, key)).limit(1).then(rows => rows[0]);
      // A reavaliação é uma solicitação explícita do operador: preserva o
      // histórico aditivo, mas não deixa uma execução normal duplicar o mesmo
      // perfil/vaga/versões.
      const retryAi = run.aiMode === "ambiguous" && analysis?.source === "rules" && analysis.confidence < 100 && !analysis.blocker;
      if (claimed?.status === "completed" && !run.reprocess && !retryAi) {
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
        if (claimed.historyId) {
          const reusedHistory = await db.select().from(triageHistory).where(eq(triageHistory.id, claimed.historyId)).limit(1).then(rows => rows[0]);
          if (reusedHistory) {
            const reusedVerdict = evaluateDeterministicTriage({ ...job, stack: parseStack(job.stack) }, canonicalProfile);
            await db.insert(userJobAnalyses).values({
              userId, jobId: job.id, profileVersion: profile.updatedAt, ...versions,
              verdict: reusedHistory.verdict, label: reusedHistory.label, blocker: reusedHistory.blocker, rows: reusedHistory.rows,
              matchingSkills: JSON.stringify(reusedVerdict.matchingSkills), missingSkills: JSON.stringify(reusedVerdict.missingSkills),
              source: reusedHistory.source, confidence: reusedHistory.confidence,
              explanation: null, createdAt: now, updatedAt: now,
            }).onConflictDoUpdate({
              target: [userJobAnalyses.userId, userJobAnalyses.jobId],
              set: { profileVersion: profile.updatedAt, ...versions, verdict: reusedHistory.verdict, label: reusedHistory.label, blocker: reusedHistory.blocker, rows: reusedHistory.rows, matchingSkills: JSON.stringify(reusedVerdict.matchingSkills), missingSkills: JSON.stringify(reusedVerdict.missingSkills), source: reusedHistory.source, confidence: reusedHistory.confidence, updatedAt: now },
            });
          }
        }
        continue;
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
          const effect = applyAiRefinement(verdict, facts);
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
        explanation, createdAt: now, updatedAt: now,
      }).onConflictDoUpdate({
        target: [userJobAnalyses.userId, userJobAnalyses.jobId],
        set: { profileVersion: profile.updatedAt, ...versions, verdict: finalVerdict.result.emoji, label: finalVerdict.result.label, blocker: finalVerdict.blocker, rows, matchingSkills: JSON.stringify(verdict.matchingSkills), missingSkills: JSON.stringify(verdict.missingSkills), source: finalSource, confidence: finalSource === "ai" ? 100 : verdict.confidence, explanation, updatedAt: now },
      });
      await db.update(triageBatchItems).set({ status: "completed", historyId, leaseOwner: null, leaseUntil: null, updatedAt: now }).where(and(eq(triageBatchItems.batchId, batchId), eq(triageBatchItems.jobId, job.id)));
      await db.update(triageDeduplication).set({ status: "completed", historyId, leaseOwner: null, leaseUntil: null, updatedAt: now }).where(eq(triageDeduplication.idempotencyKey, key));
      const safelyRefined = !aiRefinement.eligible || finalSource === "ai";
      // Etapa 2 da automação ponta a ativação: o caminho agendado só
      // enfileira rascunho para veredito ✅ Aprovada. 🟡 Provável fica
      // parada no histórico para revisão sua (ou pedido explícito de
      // refino à IA) — a fila manual do portal continua aceitando ✅ e 🟡
      // como sempre, isSafeForDraft não muda para ninguém além daqui.
      if (run.trigger === "schedule" && scheduledDraftQueueEnabled && safelyRefined && finalVerdict.result.emoji === "✅" && isSafeForDraft({
        verdict: finalVerdict.result.emoji,
        blocker: finalVerdict.blocker,
        contactEmail: job.contactEmail,
        sourceId: job.sourceId,
        deterministicVerdict: verdict.verdict,
        deterministicBlocker: verdict.blocker,
      })) {
        const outboxId = crypto.randomUUID();
        const inserted = await db.insert(draftOutbox).values({ id: outboxId, userId, jobId: job.id, historyId, status: "pending", createdAt: now, updatedAt: now }).onConflictDoNothing().returning({ id: draftOutbox.id });
        // onConflictDoNothing + returning só devolve linha quando realmente
        // inseriu (vaga já enfileirada por outra rodada não entra de novo
        // na chamada ao conector Gmail desta execução).
        if (inserted.length) scheduledOutboxIds.push(outboxId);
      }
      processed.push({ jobId: job.id, title: job.title, company: job.company, reference: job.externalId, contactEligible: Boolean(job.contactEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(job.contactEmail.trim())), aiEligible: aiRefinement.eligible, aiStatus, verdict: finalVerdict.verdict, label: finalVerdict.result.label, blocker: finalVerdict.blocker });
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
    if (run.trigger === "schedule") await notifyScheduledTriage(db, { batchId, processed: 0, approved: 0, probable: 0, rejected: 0, draftsQueued: 0, draftsCreated: 0, error: detail }).catch(() => undefined);
    return NextResponse.json({ error: "Falha no lote; nenhum rascunho foi criado.", batchId, processed, detail }, { status: 500 });
  }

  // Etapa 3: aciona o mesmo conector Gmail que o botão manual usa, para as
  // vagas que esta própria execução acabou de enfileirar. Falha aqui não
  // derruba a triagem — a vaga já está salva como "pending" e continua
  // disponível para a ação manual de sempre.
  let immediateDraft: { requested: boolean; created?: number; reason?: string } | null = null;
  if (scheduledAutoCreateEnabled && scheduledOutboxIds.length) {
    try {
      immediateDraft = await requestImmediateDraftCreation(scheduledOutboxIds);
    } catch (error) {
      immediateDraft = { requested: false, reason: error instanceof Error ? error.message : "Falha ao acionar o conector Gmail" };
    }
  }

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
      draftsQueued: scheduledOutboxIds.length,
      draftsCreated: immediateDraft?.created ?? 0,
      gmailReason: scheduledAutoCreateEnabled && scheduledOutboxIds.length && !immediateDraft?.requested ? immediateDraft?.reason ?? "conector não confirmou a criação" : null,
    }).catch(() => undefined);
  }

  return NextResponse.json({ ok: true, batchId, referenceDate: run.referenceDate, processed, skipped, aiEligible: processed.filter(item => item.aiEligible).length, aiCompleted: processed.filter(item => item.aiStatus === "completed" || item.aiStatus === "cached").length, draftsCreated: immediateDraft?.created ?? 0, immediateDraft, aiUsed: processed.some(item => item.aiStatus === "completed" || item.aiStatus === "cached") });
}
