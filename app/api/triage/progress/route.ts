import { and, count, eq, isNull, lt, lte, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { triageBatchItems, triageBatches } from "../../../../db/schema";
import { isOwnerEmail } from "../../../../lib/access";

export const dynamic = "force-dynamic";

const STALE_AFTER_MS = 5 * 60_000;

/**
 * Atualização compacta do lote ativo. Evita recarregar milhares de vagas,
 * históricos, rascunhos e logs apenas para atualizar uma barra de progresso.
 */
export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user || !isOwnerEmail(user.email)) return NextResponse.json({ error: "Acesso restrito" }, { status: 403 });
  const batchId = new URL(request.url).searchParams.get("batchId")?.trim();
  if (!batchId) return NextResponse.json({ error: "Lote obrigatório" }, { status: 400 });

  const db = getDb();
  const batch = await db.select().from(triageBatches)
    .where(and(eq(triageBatches.id, batchId), eq(triageBatches.userId, user.userId)))
    .limit(1).then((rows) => rows[0]);
  if (!batch) return NextResponse.json({ error: "Lote não encontrado" }, { status: 404 });

  const now = new Date();
  const staleBefore = new Date(now.getTime() - STALE_AFTER_MS);
  const [statusRows, recoverableRows] = await Promise.all([
    db.select({ status: triageBatchItems.status, total: count() }).from(triageBatchItems)
      .where(eq(triageBatchItems.batchId, batch.id)).groupBy(triageBatchItems.status),
    db.select({ total: count() }).from(triageBatchItems).where(and(
      eq(triageBatchItems.batchId, batch.id),
      or(
        and(eq(triageBatchItems.status, "queued"), lt(triageBatchItems.updatedAt, staleBefore)),
        and(eq(triageBatchItems.status, "processing"), or(isNull(triageBatchItems.leaseUntil), lte(triageBatchItems.leaseUntil, now))),
      ),
    )),
  ]);
  const totalFor = (status: string) => Number(statusRows.find((row) => row.status === status)?.total ?? 0);
  const counts = {
    queued: totalFor("queued"), processing: totalFor("processing"), completed: totalFor("completed"),
    failed: totalFor("failed"), skipped: totalFor("skipped"),
  };

  return NextResponse.json({
    batch: { ...batch, total: Object.values(counts).reduce((sum, value) => sum + value, 0), completed: counts.completed, failed: counts.failed },
    counts,
    recoverable: Number(recoverableRows[0]?.total ?? 0),
    polledAt: now,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
