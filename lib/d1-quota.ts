const D1_READ_LIMIT = /exceeded D1(?:'s)? free tier daily row read limit|daily row read limit/i;

export function isD1ReadQuotaError(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error ?? "");
  return D1_READ_LIMIT.test(detail);
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
