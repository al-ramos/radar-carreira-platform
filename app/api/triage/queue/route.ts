import { and, desc, eq, gte, isNull, lt } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { jobs, profiles, triageBatches, triageBatchItems, userJobAnalyses } from "../../../../db/schema";
import { canonicalizeProfile } from "../../../../lib/canonical-profile";
import { normalizeTriageRunRequest, saoPauloDayWindow, type TriageRunRequest } from "../../../../lib/triage-orchestrator";

export const dynamic = "force-dynamic";

type QueuePayload = { userId: string; batchId: string; jobId: string; run: Record<string, unknown> };
type QueueMessage = { body: QueuePayload };

/**
 * Entrada rápida da triagem manual. A seleção fica persistida antes de cada
 * item ser enviado à Queue, portanto uma atualização da base não muda o
 * recorte que o operador viu no portal.
 */
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });

  const body = await request.json().catch(() => ({})) as Partial<TriageRunRequest>;
  let run;
  try {
    run = normalizeTriageRunRequest({
      trigger: "portal", referenceDate: body.referenceDate, sourceId: body.sourceId,
      dateScope: body.dateScope, roleArea: body.roleArea, ingestionChannel: body.ingestionChannel,
      homePeriod: body.homePeriod, batchSize: body.batchSize, reprocess: body.reprocess,
      aiMode: body.aiMode ?? "off", createDrafts: false,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Parâmetros inválidos" }, { status: 400 });
  }
  if (run.aiMode !== "off") return NextResponse.json({ error: "A execução em fila usa as regras do Radar; a IA continua em fluxo próprio." }, { status: 400 });

  const queue = (env as { TRIAGE_QUEUE?: { sendBatch(messages: QueueMessage[]): Promise<void> } }).TRIAGE_QUEUE;
  if (!queue) return NextResponse.json({ error: "Fila de triagem indisponível no ambiente." }, { status: 503 });

  const db = getDb();
  const profile = await db.select().from(profiles).where(eq(profiles.userId, user.userId)).limit(1).then((rows) => rows[0]);
  if (!profile) return NextResponse.json({ error: "Complete seu perfil antes de iniciar a triagem." }, { status: 412 });
  canonicalizeProfile(profile);

  const usesHomePeriod = Boolean(run.homePeriod);
  const scopedToReferenceDay = !usesHomePeriod && (Boolean(run.sourceId) || run.dateScope === "received");
  const dateColumn = run.dateScope === "received" ? jobs.firstSeenAt : jobs.publishedAt;
  const homeCutoff = run.homePeriod && run.homePeriod !== "all" ? new Date(Date.now() - Number(run.homePeriod) * 36e5) : null;
  const candidates = await db.select({ jobId: jobs.id }).from(jobs)
    .leftJoin(userJobAnalyses, and(eq(userJobAnalyses.userId, user.userId), eq(userJobAnalyses.jobId, jobs.id)))
    .where(and(
      eq(jobs.status, "active"),
      scopedToReferenceDay ? gte(dateColumn, saoPauloDayWindow(run.referenceDate).start) : undefined,
      scopedToReferenceDay ? lt(dateColumn, saoPauloDayWindow(run.referenceDate).end) : undefined,
      homeCutoff ? gte(jobs.publishedAt, homeCutoff) : undefined,
      run.sourceId ? eq(jobs.sourceId, run.sourceId) : undefined,
      run.roleArea ? eq(jobs.roleArea, run.roleArea) : undefined,
      run.ingestionChannel ? eq(jobs.ingestionChannel, run.ingestionChannel) : undefined,
      run.reprocess ? undefined : isNull(userJobAnalyses.jobId),
    )).orderBy(desc(jobs.firstSeenAt), desc(jobs.createdAt)).limit(run.batchSize);

  if (!candidates.length) return NextResponse.json({ ok: true, batchId: null, queued: 0 });
  const now = new Date();
  const batchId = crypto.randomUUID();
  const scope = run.sourceId ? (run.homePeriod ? `source-home-period:${run.sourceId}:${run.homePeriod}` : `source-${run.dateScope}-day:${run.sourceId}`) : run.reprocess ? "reprocess" : "unreviewed";
  await db.insert(triageBatches).values({ id: batchId, userId: user.userId, trigger: "manual", scope, status: "queued", createdAt: now });
  await db.insert(triageBatchItems).values(candidates.map(({ jobId }) => ({ batchId, jobId, status: "queued", attemptCount: 0, updatedAt: now })));
  const payloads = candidates.map(({ jobId }): QueueMessage => ({ body: { userId: user.userId, batchId, jobId, run } }));
  try {
    for (let index = 0; index < payloads.length; index += 100) await queue.sendBatch(payloads.slice(index, index + 100));
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 1000) : "Não foi possível enviar o lote para a fila.";
    await db.update(triageBatches).set({ status: "failed", completedAt: new Date(), error: detail }).where(eq(triageBatches.id, batchId));
    return NextResponse.json({ error: detail, batchId }, { status: 503 });
  }
  return NextResponse.json({ ok: true, batchId, queued: candidates.length, asynchronous: true }, { status: 202 });
}
