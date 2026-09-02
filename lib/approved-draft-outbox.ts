import { and, eq } from "drizzle-orm";
import { getDb } from "../db/index";
import { draftOutbox } from "../db/schema";

/**
 * Cria a outbox de uma aprovação ou reabre uma outbox cancelada porque os
 * dados da vaga mudaram. Itens enviados nunca regridem, e itens ainda válidos
 * não são duplicados. O retorno identifica somente trabalho novo a preparar.
 */
export async function queueApprovedDraftOutbox(input: { userId: string; jobId: string; historyId: string; now: Date }): Promise<string | null> {
  const db = getDb();
  const existing = await db.select({ id: draftOutbox.id, historyId: draftOutbox.historyId, status: draftOutbox.status }).from(draftOutbox)
    .where(and(eq(draftOutbox.userId, input.userId), eq(draftOutbox.jobId, input.jobId))).limit(1).then((rows) => rows[0]);

  if (!existing) {
    const id = crypto.randomUUID();
    await db.insert(draftOutbox).values({ id, userId: input.userId, jobId: input.jobId, historyId: input.historyId, status: "pending", autoSendAuthorized: false, autoSendAuthorizedAt: null, createdAt: input.now, updatedAt: input.now });
    return id;
  }
  if (existing.status !== "cancelled" || existing.historyId === input.historyId) return null;

  await db.update(draftOutbox).set({
    historyId: input.historyId,
    status: "pending",
    autoSendAuthorized: false,
    autoSendAuthorizedAt: null,
    gmailDraftId: null,
    gmailThreadId: null,
    draftSubject: null,
    gmailSentId: null,
    sentAt: null,
    error: null,
    updatedAt: input.now,
  }).where(eq(draftOutbox.id, existing.id));
  return existing.id;
}
