import { and, asc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "../../../../../db/index";
import { draftOutbox, platformSettings } from "../../../../../db/schema";
import { requestImmediateDraftCreation } from "../../../../../lib/gmail-draft-priority";

export const dynamic = "force-dynamic";

const BATCH_SIZE = 20;

/**
 * Entrada exclusiva do cron interno do Worker. Reapresenta ao Apps Script os
 * itens que continuam pendentes depois da tentativa imediata, sem ampliar a
 * elegibilidade e sem nenhuma operação de envio de e-mail.
 */
export async function POST(request: Request) {
  if (request.headers.get("x-radar-draft-dispatch-authenticated") !== "1") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const db = getDb();
  const settings = await db.select({
    queueEnabled: platformSettings.scheduledTriageDraftQueueEnabled,
    autoCreateEnabled: platformSettings.scheduledTriageAutoCreateEnabled,
  }).from(platformSettings).where(eq(platformSettings.id, "global")).limit(1).then((rows) => rows[0]);

  if (!settings?.queueEnabled || !settings.autoCreateEnabled) {
    return NextResponse.json({ ok: true, skipped: "Criação automática de rascunhos está desativada." });
  }

  const pending = await db.select({ id: draftOutbox.id })
    .from(draftOutbox)
    .where(eq(draftOutbox.status, "pending"))
    .orderBy(asc(draftOutbox.createdAt))
    .limit(BATCH_SIZE);
  if (!pending.length) return NextResponse.json({ ok: true, attempted: 0, created: 0 });

  const result = await requestImmediateDraftCreation(pending.map((item) => item.id));
  if (!result.requested || !result.created) {
    const reason = result.reason ?? "O conector Gmail não criou o rascunho nesta tentativa; o Radar tentará novamente automaticamente.";
    await db.update(draftOutbox)
      .set({ error: reason.slice(0, 1000), updatedAt: new Date() })
      .where(and(eq(draftOutbox.status, "pending"), inArray(draftOutbox.id, pending.map((item) => item.id))));
  }
  return NextResponse.json({ ok: true, attempted: pending.length, created: result.created ?? 0, retryScheduled: !result.created });
}
