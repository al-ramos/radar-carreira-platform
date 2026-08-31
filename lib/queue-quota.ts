import { and, eq, lte, sql } from "drizzle-orm";
import { queueDailyUsage } from "../db/schema";

/** Mantém 25% de margem na cota gratuita de 10.000 operações/dia. */
export const QUEUE_DAILY_OPERATION_BUDGET = 7_500;
export const QUEUE_OPERATIONS_PER_MESSAGE = 3;
const TOTAL_QUEUE = "__total__";

type Db = ReturnType<typeof import("../db/index").getDb>;
const utcDay = (now = new Date()) => now.toISOString().slice(0, 10);

export function queueResetAt(now = new Date()) {
  const reset = new Date(now);
  reset.setUTCHours(24, 0, 0, 0);
  return reset.toISOString();
}

async function ensureUsageRow(db: Db, dayUtc: string, queue: string, now: Date) {
  await db.insert(queueDailyUsage).values({ dayUtc, queue, updatedAt: now })
    .onConflictDoNothing();
}

/** Reserva a estimativa conservadora de write + read + delete antes do envio. */
export async function reserveQueueMessages(db: Db, queue: string, messageCount: number, budget = QUEUE_DAILY_OPERATION_BUDGET, now = new Date()) {
  const messages = Math.max(0, Math.floor(messageCount));
  const operations = messages * QUEUE_OPERATIONS_PER_MESSAGE;
  const dayUtc = utcDay(now);
  if (!operations) return { allowed: true, operations: 0, resetAt: queueResetAt(now) };
  await ensureUsageRow(db, dayUtc, TOTAL_QUEUE, now);
  const total = await db.update(queueDailyUsage).set({
    reservedOperations: sql`${queueDailyUsage.reservedOperations} + ${operations}`,
    emittedMessages: sql`${queueDailyUsage.emittedMessages} + ${messages}`,
    updatedAt: now,
  }).where(and(eq(queueDailyUsage.dayUtc, dayUtc), eq(queueDailyUsage.queue, TOTAL_QUEUE), lte(queueDailyUsage.reservedOperations, budget - operations)));
  if (!total.meta.changes) return { allowed: false, operations, resetAt: queueResetAt(now) };
  await ensureUsageRow(db, dayUtc, queue, now);
  await db.update(queueDailyUsage).set({
    reservedOperations: sql`${queueDailyUsage.reservedOperations} + ${operations}`,
    emittedMessages: sql`${queueDailyUsage.emittedMessages} + ${messages}`,
    updatedAt: now,
  }).where(and(eq(queueDailyUsage.dayUtc, dayUtc), eq(queueDailyUsage.queue, queue)));
  return { allowed: true, operations, resetAt: queueResetAt(now) };
}

export async function queueUsageForToday(db: Db, budget = QUEUE_DAILY_OPERATION_BUDGET, now = new Date()) {
  const rows = await db.select().from(queueDailyUsage).where(eq(queueDailyUsage.dayUtc, utcDay(now)));
  const total = rows.find((row) => row.queue === TOTAL_QUEUE);
  return { budget, reservedOperations: total?.reservedOperations ?? 0, retryOperations: total?.retryOperations ?? 0, updatedAt: total?.updatedAt ?? null, resetAt: queueResetAt(now), queues: rows.filter((row) => row.queue !== TOTAL_QUEUE) };
}
