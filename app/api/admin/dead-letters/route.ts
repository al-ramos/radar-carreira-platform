import { and, desc, eq, inArray } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { can } from "../../../../lib/rbac";
import { getDb } from "../../../../db/index";
import { queueDeadLetters } from "../../../../db/schema";
import { reserveQueueMessages } from "../../../../lib/queue-quota";

export const dynamic = "force-dynamic";

/**
 * T1 — mensagens que esgotaram as tentativas da fila. Antes deste endpoint
 * elas caíam numa dead letter queue sem consumidor: sumiam da visão de quem
 * opera sem aparecer como pendentes nem como falhas. O reenfileiramento é
 * sempre explícito; nada aqui reprocessa sozinho.
 */
const QUEUE_BINDINGS: Record<string, string> = {
  "radar-carreira-triage-manual": "MANUAL_TRIAGE_QUEUE",
  "radar-carreira-triage": "TRIAGE_QUEUE",
  "radar-carreira-ai-review": "AI_REVIEW_QUEUE",
};

const MAX_REQUEUE = 25;

async function operator() {
  const user = await getChatGPTUser();
  if (!user) return null;
  // Mesma permissão do Monitoramento: quem enxerga a operação é quem pode
  // devolver um item à fila.
  return await can(user, "monitor.view") ? user : null;
}

export async function GET() {
  if (!await operator()) return NextResponse.json({ error: "Acesso restrito" }, { status: 403 });
  const rows = await getDb().select().from(queueDeadLetters)
    .where(eq(queueDeadLetters.status, "pending"))
    .orderBy(desc(queueDeadLetters.createdAt))
    .limit(50);
  return NextResponse.json({
    pending: rows.length,
    items: rows.map((row) => ({
      id: row.id,
      queue: row.queue,
      kind: row.kind,
      jobId: row.jobId,
      batchId: row.batchId,
      attempts: row.attempts,
      createdAt: row.createdAt,
      // A DLQ entrega a mensagem, não o erro que a matou. Dizer isso é melhor
      // que exibir um motivo inventado.
      reason: row.lastError ?? "A fila não transporta o erro da tentativa; consulte o log do Worker por este id.",
      requeueable: Boolean(QUEUE_BINDINGS[row.queue]),
    })),
  });
}

export async function POST(request: Request) {
  if (!await operator()) return NextResponse.json({ error: "Acesso restrito" }, { status: 403 });
  const body = await request.json().catch(() => null) as { action?: "requeue" | "dismiss"; ids?: unknown } | null;
  const ids = Array.isArray(body?.ids)
    ? [...new Set(body.ids.filter((id): id is string => typeof id === "string" && id.length > 0))].slice(0, MAX_REQUEUE)
    : [];
  if (!ids.length) return NextResponse.json({ error: "Informe os itens a tratar." }, { status: 400 });

  const db = getDb();
  const rows = await db.select().from(queueDeadLetters)
    .where(and(inArray(queueDeadLetters.id, ids), eq(queueDeadLetters.status, "pending")));
  if (!rows.length) return NextResponse.json({ error: "Nenhum item pendente com os identificadores informados." }, { status: 404 });

  const now = new Date();
  if (body?.action === "dismiss") {
    await db.update(queueDeadLetters).set({ status: "dismissed", updatedAt: now })
      .where(inArray(queueDeadLetters.id, rows.map((row) => row.id)));
    return NextResponse.json({ ok: true, dismissed: rows.length });
  }

  // O orçamento diário de operações de fila é o mesmo dos envios normais:
  // reenfileirar em massa não pode furar a cota que protege o restante.
  const reservation = await reserveQueueMessages(db, "dead-letter-requeue", rows.length);
  if (!reservation.allowed) {
    return NextResponse.json({
      error: "O orçamento diário de operações de fila foi atingido; o reenfileiramento pode ser retomado após a virada.",
      code: "QUEUE_DAILY_BUDGET",
      resetAt: reservation.resetAt,
    }, { status: 429 });
  }

  const requeued: string[] = [];
  const failed: Array<{ id: string; reason: string }> = [];
  for (const row of rows) {
    const binding = QUEUE_BINDINGS[row.queue];
    const queue = binding ? (env as unknown as Record<string, { send(message: unknown): Promise<void> } | undefined>)[binding] : undefined;
    if (!queue) {
      failed.push({ id: row.id, reason: `Fila de origem desconhecida: ${row.queue}` });
      continue;
    }
    try {
      await queue.send(JSON.parse(row.payload));
      requeued.push(row.id);
    } catch (error) {
      failed.push({ id: row.id, reason: error instanceof Error ? error.message.slice(0, 300) : "Falha ao reenfileirar" });
    }
  }
  if (requeued.length) {
    await db.update(queueDeadLetters).set({ status: "requeued", updatedAt: now })
      .where(inArray(queueDeadLetters.id, requeued));
  }
  return NextResponse.json({ ok: failed.length === 0, requeued: requeued.length, failed });
}
