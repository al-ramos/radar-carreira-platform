import { getDb } from "../db/index";
import { databaseFailures } from "../db/schema";

const redact = (value: string) => value
  .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[e-mail redigido]")
  .replace(/https?:\/\/\S+/g, "[URL redigida]")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, 300);

const messageOf = (error: unknown) => redact(error instanceof Error ? error.message : "Falha desconhecida no banco de dados");

/** Evita transformar falhas de conectores, e-mail ou IA em falsos incidentes do D1. */
export const isDatabaseFailure = (error: unknown) => /\b(d1|sqlite|database|sql|query|transaction|constraint)\b|\bDB\b.*\b(binding|unavailable)\b/i.test(messageOf(error));

export async function recordDatabaseFailure(operation: string, error: unknown, impact: string, correlationId?: string) {
  if (!isDatabaseFailure(error)) return false;

  const safeError = messageOf(error);
  try {
    await getDb().insert(databaseFailures).values({
      id: crypto.randomUUID(),
      operation,
      impact: redact(impact),
      error: safeError,
      correlationId: correlationId ?? null,
      occurredAt: new Date(),
    });
    return true;
  } catch {
    // Se o D1 estiver indisponível, não há onde persistir o incidente. O log
    // sanitizado permanece na observabilidade nativa do Worker.
    console.error("Falha D1 não persistida", { operation, impact: redact(impact), error: safeError, correlationId });
    return false;
  }
}

export async function trackDatabaseOperation<T>(operation: string, impact: string, action: () => Promise<T>, correlationId?: string) {
  try {
    return await action();
  } catch (error) {
    await recordDatabaseFailure(operation, error, impact, correlationId);
    throw error;
  }
}
