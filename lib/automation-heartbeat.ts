import { getDb } from "../db/index";
import { automationHeartbeats } from "../db/schema";

type Status = "running" | "completed" | "failed" | "skipped";

/**
 * Um motivo precisa dizer algo. `String(new Error())` devolve "Error", e um
 * Error sem mensagem devolve "" — os dois ocupavam a coluna de motivo sem
 * explicar nada. Aqui essas formas viram um texto que ao menos avisa que o
 * motivo não foi informado, em vez de fingir que foi.
 */
const EMPTY_REASON = /^(error|exception|erro|\[object object\]|undefined|null)$/i;
export function describeFailure(error: unknown, fallback = "Falha sem motivo informado pela origem") {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const text = raw.trim();
  return !text || EMPTY_REASON.test(text) ? fallback : text;
}

const safe = (error: unknown) => describeFailure(error).replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[e-mail redigido]").replace(/https?:\/\/\S+/g, "[URL redigida]").slice(0, 300);

export async function heartbeat(id: string, status: Status, error?: unknown) {
  const now = new Date();
  const values = { id, status, startedAt: now, completedAt: status === "running" ? null : now, error: error ? safe(error) : null, updatedAt: now };
  await getDb().insert(automationHeartbeats).values(values).onConflictDoUpdate({ target: automationHeartbeats.id, set: { status: values.status, completedAt: values.completedAt, error: values.error, updatedAt: values.updatedAt } });
}
