const D1_READ_LIMIT = /exceeded D1(?:'s)? free tier daily row read limit|daily row read limit/i;

function errorDetail(error: unknown, seen = new Set<unknown>()): string {
  if (error == null || seen.has(error)) return "";
  if (typeof error === "string") return error;
  if (typeof error !== "object") return String(error);
  seen.add(error);
  const value = error as { message?: unknown; cause?: unknown; errors?: unknown; stack?: unknown };
  return [
    typeof value.message === "string" ? value.message : "",
    typeof value.stack === "string" ? value.stack : "",
    errorDetail(value.cause, seen),
    ...(Array.isArray(value.errors) ? value.errors.map((item) => errorDetail(item, seen)) : []),
  ].filter(Boolean).join("\n");
}

export function isD1ReadQuotaError(error: unknown) {
  return D1_READ_LIMIT.test(errorDetail(error));
}

export function nextD1Reset(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

export function d1QuotaResponse(error: unknown, now = new Date()) {
  if (!isD1ReadQuotaError(error)) return null;
  const resetAt = nextD1Reset(now);
  const retryAfter = Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1_000));
  return Response.json({
    error: `A cota diária de leituras do banco foi atingida. O lote não foi importado; a operação poderá ser retomada após ${resetAt.toISOString()}.`,
    code: "D1_DAILY_READ_LIMIT",
    retryable: true,
    resetAt: resetAt.toISOString(),
  }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
}
