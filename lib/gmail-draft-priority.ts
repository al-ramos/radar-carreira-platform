type ImmediateDraftResult = { requested: boolean; created?: number; reason?: string };
type ImmediateSentReconciliationResult = { requested: boolean; confirmed?: number; reason?: string };

/**
 * Aciona o Apps Script somente para itens escolhidos manualmente. A URL e o
 * token ficam em secrets do Worker. A criação é sempre iniciada por uma ação
 * manual no Radar; não há rotina programada como alternativa.
 */
export async function requestImmediateDraftCreation(outboxIds: string[]): Promise<ImmediateDraftResult> {
  const url = process.env.GMAIL_DRAFTS_WEBHOOK_URL?.trim();
  const token = process.env.GMAIL_DRAFTS_WEBHOOK_TOKEN?.trim();
  if (!url || !token || !outboxIds.length) return { requested: false, reason: "Conector Gmail imediato ainda não configurado." };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "prioritizeDrafts", token, outboxIds }),
    });
    const payload = await response.json().catch(() => null) as { ok?: boolean; created?: number; error?: string } | null;
    if (!response.ok || !payload?.ok) return { requested: false, reason: payload?.error ?? "O conector Gmail não confirmou a criação imediata." };
    return { requested: true, created: Number(payload.created ?? 0) };
  } catch {
    return { requested: false, reason: "Não foi possível acionar o conector Gmail agora. Tente novamente pela ação manual." };
  }
}

/** Confere exclusivamente os rascunhos escolhidos na pasta Enviados do Gmail. */
export async function requestImmediateSentReconciliation(outboxIds: string[]): Promise<ImmediateSentReconciliationResult> {
  const url = process.env.GMAIL_DRAFTS_WEBHOOK_URL?.trim();
  const token = process.env.GMAIL_DRAFTS_WEBHOOK_TOKEN?.trim();
  if (!url || !token || !outboxIds.length) return { requested: false, reason: "Conector Gmail imediato ainda não configurado." };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "reconcileSent", token, outboxIds }),
    });
    const payload = await response.json().catch(() => null) as { ok?: boolean; confirmed?: number; error?: string } | null;
    if (!response.ok || !payload?.ok) return { requested: false, reason: payload?.error ?? "O conector Gmail não confirmou a atualização do envio." };
    return { requested: true, confirmed: Number(payload.confirmed ?? 0) };
  } catch {
    return { requested: false, reason: "Não foi possível consultar o Gmail agora." };
  }
}
