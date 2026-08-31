export type TriageObservabilityStatus = "healthy" | "warning" | "blocked";

type Failure = { error: string | null; at: Date | string | null } | null;

export type TriageObservabilityInput = {
  now?: Date;
  budget: number;
  reservedOperations: number;
  retryOperations: number;
  resetAt: string;
  scheduledEnabled: boolean;
  failure: Failure;
};

const quotaFailure = (error: string | null | undefined) => /daily (?:write )?operations limit|queue.*(?:quota|limit)|limite preventivo diário/i.test(error ?? "");

export function queueOperationCount(error: string | null | undefined) {
  if (!error) return null;
  const match = error.match(/\((\d{3,})\)/) ?? error.match(/(?:operations|operações)[^\d]*(\d{3,})/i);
  return match ? Number(match[1]) : null;
}

/** Próxima coleta agendada: dias úteis, 08:15 em São Paulo (11:15 UTC). */
export function nextCollectionAt(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  let candidate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 11, 15));
  if (candidate.getTime() <= now.getTime()) candidate = new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
  while (candidate.getUTCDay() === 0 || candidate.getUTCDay() === 6) candidate = new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
  return candidate.toISOString();
}

export function deriveTriageObservability(input: TriageObservabilityInput) {
  const now = input.now ?? new Date();
  const failureAt = input.failure?.at ? new Date(input.failure.at) : null;
  const resetAt = new Date(input.resetAt);
  const currentQuotaWindowStart = new Date(resetAt.getTime() - 24 * 60 * 60 * 1000);
  const currentFailure = Boolean(failureAt && failureAt >= currentQuotaWindowStart && failureAt <= now);
  const blocked = currentFailure && quotaFailure(input.failure?.error);
  const preventiveBlock = blocked && /limite preventivo/i.test(input.failure?.error ?? "");
  const reportedOperations = blocked ? queueOperationCount(input.failure?.error) : null;
  const usedOperations = Math.max(input.reservedOperations + input.retryOperations * 3, reportedOperations ?? 0);
  const utilization = Math.min(100, Math.round((usedOperations / Math.max(1, input.budget)) * 100));
  const warning = currentFailure || utilization >= 80 || !input.scheduledEnabled;
  const status: TriageObservabilityStatus = blocked ? "blocked" : warning ? "warning" : "healthy";

  const reason = blocked
    ? preventiveBlock
      ? "A trava preventiva da fila foi atingida antes da cota máxima; novos envios ficam pausados até o reset."
      : "A cota diária do Cloudflare Queues foi atingida; novas mensagens ficam bloqueadas até o reset."
    : currentFailure
      ? input.failure?.error ?? "A última execução registrou uma falha."
      : !input.scheduledEnabled
        ? "A triagem agendada está desativada nas configurações."
        : utilization >= 80
          ? "A reserva preventiva da fila passou de 80% do orçamento diário."
          : "Fila dentro do orçamento e sem falha operacional atual.";
  const action = blocked
    ? "Aguarde o reset da cota. A próxima coleta útil reenfileira somente as fontes importadas; use a ação manual apenas se precisar antecipar."
    : currentFailure
      ? "Abra o log da última triagem, corrija a causa e retome apenas os itens pendentes."
      : !input.scheduledEnabled
        ? "Ative a triagem agendada em Configurações quando quiser retomar o fluxo automático."
        : utilization >= 80
          ? "Evite reprocessamentos amplos hoje; a trava preventiva impedirá novos envios ao atingir o orçamento."
          : "Nenhuma ação necessária.";

  return {
    status,
    usedOperations,
    utilization,
    reason,
    action,
    quotaResetAt: input.resetAt,
    nextExecutionAt: input.scheduledEnabled ? nextCollectionAt(now) : null,
    nextExecutionReason: input.scheduledEnabled
      ? "Próxima coleta útil; a triagem é disparada somente para as fontes que concluírem importação."
      : "Sem próxima execução enquanto a triagem agendada estiver desativada.",
  };
}
