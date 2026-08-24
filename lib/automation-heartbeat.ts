import { eq } from "drizzle-orm";
import { getDb } from "../db/index";
import { automationHeartbeats } from "../db/schema";

type Status = "running" | "completed" | "failed" | "skipped";
const safe = (error: unknown) => (error instanceof Error ? error.message : "Falha desconhecida").replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[e-mail redigido]").replace(/https?:\/\/\S+/g, "[URL redigida]").slice(0, 300);

export async function heartbeat(id: string, status: Status, error?: unknown) {
  const now = new Date();
  const values = { id, status, startedAt: now, completedAt: status === "running" ? null : now, error: error ? safe(error) : null, updatedAt: now };
  await getDb().insert(automationHeartbeats).values(values).onConflictDoUpdate({ target: automationHeartbeats.id, set: { status: values.status, completedAt: values.completedAt, error: values.error, updatedAt: values.updatedAt } });
}
