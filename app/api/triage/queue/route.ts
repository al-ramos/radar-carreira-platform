import { and, desc, eq, gte, isNull, lt, or } from "drizzle-orm";
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
type QueueRequest = Partial<TriageRunRequest> & { action?: "resume"; batchId?: string };

const STALE_QUEUE_ITEM_MS = 5 * 60_000;
// Registrar centenas de itens e mensagens em uma única requisição excede o
// orçamento do Worker. A Queue processa cada vaga depois, com concorrência
// limitada; este teto protege apenas a criação do lote manual.
const MANUAL_TRIAGE_BATCH_SIZE = 100;

async function resumePendingBatch({ userId, batchId, queue }: { userId: string; batchId: string; queue: { sendBatch(messages: QueueMessage[]): Promise<void> } }) {
  const db = getDb();
  const batch = await db.select().from(triageBatches)
    .where(and(eq(triageBatches.id, batchId), eq(triageBatches.userId, userId)))
    .limit(1)
    .then((rows) => rows[0]);
  if (!batch) return { status: 404 as const, error: "Lote de triagem não encontrado." };

  const now = new Date();
  const staleBefore = new Date(now.getTime() - STALE_QUEUE_ITEM_MS);
  // Um item pode parar em "processing" se a execução for interrompida após
  // a reserva, mas antes da resposta final. Só é seguro retomá-lo quando a
  // reserva expirou; uma análise que ainda possui reserva válida permanece
  // intocada para não rodar duas vezes em paralelo.
  const recoverableItem = or(
    and(eq(triageBatchItems.status, "queued"), lt(triageBatchItems.updatedAt, staleBefore)),
    and(eq(triageBatchItems.status, "processing"), or(isNull(triageBatchItems.leaseUntil), lt(triageBatchItems.leaseUntil, now))),
  );
  const pending = await db.select({ jobId: triageBatchItems.jobId }).from(triageBatchItems)
    .where(and(
      eq(triageBatchItems.batchId, batchId),
      recoverableItem,
    ));
  if (!pending.length) return { status: 200 as const, resumed: 0 };

  // A seleção do lote é persistida: o executor recebe cada jobId e ignora
  // qualquer vaga que tenha sido concluída entre a interrupção e a retomada.
  const run = normalizeTriageRunRequest({ trigger: "portal", batchSize: 1, aiMode: "off", createDrafts: false });
  await db.update(triageBatchItems).set({ status: "queued", leaseOwner: null, leaseUntil: null, error: null, updatedAt: now })
    .where(and(eq(triageBatchItems.batchId, batchId), recoverableItem));
  await db.update(triageBatches).set({ status: "queued", error: null, completedAt: null }).where(eq(triageBatches.id, batchId));

  const messages = pending.map(({ jobId }): QueueMessage => ({ body: { userId, batchId, jobId, run } }));
  for (let index = 0; index < messages.length; index += 100) await queue.sendBatch(messages.slice(index, index + 100));
  return { status: 202 as const, resumed: messages.length };
}

/**
 * Entrada rápida da triagem manual. A seleção fica persistida antes de cada
 * item ser enviado à Queue, portanto uma atualização da base não muda o
 * recorte que o operador viu no portal.
 */
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });

  const body = await request.json().catch(() => ({})) as QueueRequest;
  const queue = (env as { TRIAGE_QUEUE?: { sendBatch(messages: QueueMessage[]): Promise<void> } }).TRIAGE_QUEUE;
  if (!queue) return NextResponse.json({ error: "Fila de triagem indisponível no ambiente." }, { status: 503 });
  if (body.action === "resume") {
    if (!body.batchId) return NextResponse.json({ error: "Informe o lote a retomar." }, { status: 400 });
    try {
      const result = await resumePendingBatch({ userId: user.userId, batchId: body.batchId, queue });
      return result.status === 404
        ? NextResponse.json({ error: result.error }, { status: result.status })
        : NextResponse.json({ ok: true, resumed: result.resumed }, { status: result.status });
    } catch (error) {
      const detail = error instanceof Error ? error.message.slice(0, 1000) : "Não foi possível retomar os itens pendentes.";
      return NextResponse.json({ error: detail }, { status: 503 });
    }
  }
  let run;
  try {
    run = normalizeTriageRunRequest({
      trigger: "portal", referenceDate: body.referenceDate, sourceId: body.sourceId,
      dateScope: body.dateScope, roleArea: body.roleArea, ingestionChannel: body.ingestionChannel,
      homePeriod: body.homePeriod, batchSize: Math.min(Number(body.batchSize) || MANUAL_TRIAGE_BATCH_SIZE, MANUAL_TRIAGE_BATCH_SIZE), reprocess: body.reprocess,
      aiMode: body.aiMode ?? "off", createDrafts: false,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Parâmetros inválidos" }, { status: 400 });
  }
  if (run.aiMode !== "off") return NextResponse.json({ error: "A execução em fila usa as regras do Radar; a IA continua em fluxo próprio." }, { status: 400 });

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
      homeCutoff ? gte(jobs.firstSeenAt, homeCutoff) : undefined,
      run.sourceId ? eq(jobs.sourceId, run.sourceId) : undefined,
      run.roleArea ? eq(jobs.roleArea, run.roleArea) : undefined,
      run.ingestionChannel ? eq(jobs.ingestionChannel, run.ingestionChannel) : undefined,
      run.reprocess ? undefined : isNull(userJobAnalyses.jobId),
    )).orderBy(desc(jobs.firstSeenAt), desc(jobs.createdAt)).limit(run.batchSize);

  if (!candidates.length) return NextResponse.json({ ok: true, batchId: null, queued: 0 });
  const now = new Date();
  const batchId = crypto.randomUUID();
  const scope = run.sourceId ? (run.homePeriod ? `source-home-period:${run.sourceId}:${run.homePeriod}` : `source-${run.dateScope}-day:${run.sourceId}`) : run.reprocess ? "reprocess" : "unreviewed";
  try {
    await db.insert(triageBatches).values({ id: batchId, userId: user.userId, trigger: "manual", scope, status: "queued", createdAt: now });
    // D1 limita a ~100 parâmetros vinculados por statement. Cada linha de
    // triageBatchItems usa 9 colunas, então um único insert com mais de ~11
    // vagas já estoura o limite e o D1 lança um erro (ex.: lotes de 57 vagas
    // da APInfo). Insere em fatias pequenas para nunca esbarrar nesse teto.
    const itemsChunkSize = 10;
    const items = candidates.map(({ jobId }) => ({ batchId, jobId, status: "queued" as const, attemptCount: 0, updatedAt: now }));
    for (let index = 0; index < items.length; index += itemsChunkSize) {
      await db.insert(triageBatchItems).values(items.slice(index, index + itemsChunkSize));
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 1000) : "Não foi possível registrar o lote no banco.";
    await db.update(triageBatches).set({ status: "failed", completedAt: new Date(), error: detail }).where(eq(triageBatches.id, batchId)).catch(() => {});
    return NextResponse.json({ error: detail, batchId }, { status: 503 });
  }
  const payloads = candidates.map(({ jobId }): QueueMessage => ({ body: { userId: user.userId, batchId, jobId, run } }));
  try {
    for (let index = 0; index < payloads.length; index += 100) await queue.sendBatch(payloads.slice(index, index + 100));
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 1000) : "Não foi possível enviar o lote para a fila.";
    await db.update(triageBatches).set({ status: "failed", completedAt: new Date(), error: detail }).where(eq(triageBatches.id, batchId));
    return NextResponse.json({ error: detail, batchId }, { status: 503 });
  }
  return NextResponse.json({ ok: true, batchId, queued: candidates.length, hasMore: candidates.length === MANUAL_TRIAGE_BATCH_SIZE, asynchronous: true }, { status: 202 });
}
