import { and, desc, eq, gte, isNull, lt } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { draftOutbox, jobSources, jobs, profiles, triageBatchItems, triageBatches, triageDeduplication, triageHistory, userJobAnalyses } from "../../../../db/schema";
import { getAnalysisVersions } from "../../../../lib/analysis-versions";
import { canonicalizeProfile } from "../../../../lib/canonical-profile";
import { evaluateDeterministicTriage } from "../../../../lib/deterministic-triage";
import { normalizeTriageRunRequest, type TriageRunRequest } from "../../../../lib/triage-orchestrator";
import { triageIdempotencyKey } from "../../../../lib/triage-idempotency";
import { hasValidContactEmail } from "../../../../lib/contact-email";

export const dynamic = "force-dynamic";
const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
function saoPauloWindow(date: string) { return { start: new Date(`${date}T00:00:00-03:00`), end: new Date(`${date}T24:00:00-03:00`) }; }

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
 * Esta primeira etapa é deliberadamente determinística: IA e Gmail ficam
 * bloqueados até a revisão humana do lote-piloto.
 */
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const source = bearer ? (await getDb().select().from(jobSources).where(eq(jobSources.id, "gmail-radarvagas")).limit(1))[0] : null;
  let scheduledUserId: string | null = null;
  try { const config = source ? JSON.parse(source.externalRef) as { hash?: string; userId?: string } : null; if (config?.hash && config.userId && bearer && await digest(bearer) === config.hash) scheduledUserId = config.userId; } catch { /* autenticação normal permanece disponível */ }
  const userId = user?.userId ?? scheduledUserId;
  if (!userId) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });

  let body: Partial<TriageRunRequest> = {};
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
      batchSize: body.batchSize,
      reprocess: body.reprocess,
      aiMode: body.aiMode ?? "off",
      createDrafts: body.createDrafts ?? false,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Parâmetros inválidos" }, { status: 400 });
  }
  if (scheduledUserId && run.trigger !== "schedule") return NextResponse.json({ error: "A chave de agenda só pode iniciar a rotina agendada." }, { status: 403 });
  if (run.aiMode !== "off" || run.createDrafts) {
    return NextResponse.json({ error: "O piloto aceita apenas regras determinísticas e não cria rascunhos." }, { status: 400 });
  }

  const db = getDb();
  const profile = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1).then(rows => rows[0]);
  if (!profile) return NextResponse.json({ error: "Complete seu perfil antes de iniciar a triagem." }, { status: 412 });

  const canonicalProfile = canonicalizeProfile(profile);
  const versions = getAnalysisVersions(canonicalProfile);
  // Uma fonte informada transforma a execução manual em um recorte diário
  // explícito. Isso preserva o comportamento normal do portal, mas permite
  // lotes excepcionais (por exemplo, APInfo de hoje) sem misturar vagas de
  // outras origens ou datas.
  const scopedToReferenceDay = run.trigger === "schedule" || Boolean(run.sourceId);
  const candidates = await db
    .select({ job: jobs })
    .from(jobs)
    .leftJoin(userJobAnalyses, and(eq(userJobAnalyses.userId, userId), eq(userJobAnalyses.jobId, jobs.id)))
    .where(and(
      eq(jobs.status, "active"),
      scopedToReferenceDay ? gte(jobs.firstSeenAt, saoPauloWindow(run.referenceDate).start) : undefined,
      scopedToReferenceDay ? lt(jobs.firstSeenAt, saoPauloWindow(run.referenceDate).end) : undefined,
      run.sourceId ? eq(jobs.sourceId, run.sourceId) : undefined,
      run.reprocess ? undefined : isNull(userJobAnalyses.jobId),
    ))
    .orderBy(desc(jobs.firstSeenAt), desc(jobs.createdAt))
    .limit(run.batchSize);

  const now = new Date();
  const batchId = crypto.randomUUID();
  const trigger = run.trigger === "portal" ? "manual" : run.trigger === "schedule" ? "scheduled" : "assistant";
  await db.insert(triageBatches).values({
    id: batchId, userId, trigger,
    scope: run.sourceId ? `source-day:${run.sourceId}` : run.trigger === "schedule" ? "schedule-day" : run.reprocess ? "reprocess" : "unreviewed",
    status: "running", startedAt: now, createdAt: now,
  });

  const processed: Array<{ jobId: string; title: string; company: string; reference: string | null; contactEligible: boolean; verdict: string; label: string; blocker: string | null }> = [];
  let skipped = 0;
  try {
    for (const { job } of candidates) {
      const key = triageIdempotencyKey(userId, job.id, versions);
      const claimed = await db.select().from(triageDeduplication).where(eq(triageDeduplication.idempotencyKey, key)).limit(1).then(rows => rows[0]);
      // A reavaliação é uma solicitação explícita do operador: preserva o
      // histórico aditivo, mas não deixa uma execução normal duplicar o mesmo
      // perfil/vaga/versões.
      if (claimed?.status === "completed" && !run.reprocess) {
        skipped += 1;
        continue;
      }

      const historyId = crypto.randomUUID();
      const verdict = evaluateDeterministicTriage({ ...job, stack: parseStack(job.stack) }, canonicalProfile);
      const rows = JSON.stringify(verdict.result.rows);
      await db.insert(triageDeduplication).values({
        idempotencyKey: key, userId, jobId: job.id, ...versions, status: "processing", leaseOwner: batchId, leaseUntil: new Date(now.getTime() + 5 * 60_000), attemptCount: 1, updatedAt: now,
      }).onConflictDoUpdate({
        target: triageDeduplication.idempotencyKey,
        set: { status: "processing", leaseOwner: batchId, leaseUntil: new Date(now.getTime() + 5 * 60_000), updatedAt: now },
      });
      await db.insert(triageBatchItems).values({ batchId, jobId: job.id, status: "processing", attemptCount: 1, leaseOwner: batchId, leaseUntil: new Date(now.getTime() + 5 * 60_000), updatedAt: now });
      await db.insert(triageHistory).values({
        id: historyId, batchId, userId, jobId: job.id, ...versions,
        verdict: verdict.result.emoji, label: verdict.result.label, blocker: verdict.blocker, source: "rules", confidence: verdict.confidence, rows, createdAt: now,
      });
      await db.insert(userJobAnalyses).values({
        userId, jobId: job.id, profileVersion: profile.updatedAt, ...versions,
        verdict: verdict.result.emoji, label: verdict.result.label, blocker: verdict.blocker, rows,
        matchingSkills: JSON.stringify(verdict.matchingSkills), missingSkills: JSON.stringify(verdict.missingSkills), source: "rules", confidence: verdict.confidence,
        explanation: null, createdAt: now, updatedAt: now,
      }).onConflictDoUpdate({
        target: [userJobAnalyses.userId, userJobAnalyses.jobId],
        set: { profileVersion: profile.updatedAt, ...versions, verdict: verdict.result.emoji, label: verdict.result.label, blocker: verdict.blocker, rows, matchingSkills: JSON.stringify(verdict.matchingSkills), missingSkills: JSON.stringify(verdict.missingSkills), source: "rules", confidence: verdict.confidence, explanation: null, updatedAt: now },
      });
      await db.update(triageBatchItems).set({ status: "completed", historyId, leaseOwner: null, leaseUntil: null, updatedAt: now }).where(and(eq(triageBatchItems.batchId, batchId), eq(triageBatchItems.jobId, job.id)));
      await db.update(triageDeduplication).set({ status: "completed", historyId, leaseOwner: null, leaseUntil: null, updatedAt: now }).where(eq(triageDeduplication.idempotencyKey, key));
      if (run.trigger === "schedule" && (verdict.verdict === "BATE" || verdict.verdict === "PROVAVEL") && hasValidContactEmail(job.contactEmail)) {
        await db.insert(draftOutbox).values({ id: crypto.randomUUID(), userId, jobId: job.id, historyId, status: "pending", createdAt: now, updatedAt: now }).onConflictDoNothing();
      }
      processed.push({ jobId: job.id, title: job.title, company: job.company, reference: job.externalId, contactEligible: Boolean(job.contactEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(job.contactEmail.trim())), verdict: verdict.verdict, label: verdict.result.label, blocker: verdict.blocker });
    }
    await db.update(triageBatches).set({ status: "completed", completedAt: new Date() }).where(eq(triageBatches.id, batchId));
  } catch (error) {
    await db.update(triageBatches).set({ status: "failed", completedAt: new Date() }).where(eq(triageBatches.id, batchId));
    return NextResponse.json({ error: "Falha no lote; nenhum rascunho foi criado.", batchId, processed, detail: error instanceof Error ? error.message : "Erro desconhecido" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, batchId, referenceDate: run.referenceDate, processed, skipped, draftsCreated: 0, aiUsed: false });
}
