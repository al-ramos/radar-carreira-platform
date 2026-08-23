type ImmediateDraftResult = { requested: boolean; created?: number; reason?: string };
type ImmediateSentReconciliationResult = { requested: boolean; confirmed?: number; reason?: string };

/**
 * Aciona o Apps Script para os itens informados. A URL e o token ficam em
 * secrets do Worker. Chamada tanto por uma ação manual no portal quanto pela
 * triagem agendada (app/api/triage/run), sempre para vagas que já passaram
 * pela mesma validação de segurança (isSafeForDraft) antes de entrar na fila.
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
    const raw = await response.text();
    const payload = parseJson(raw) as { ok?: boolean; created?: number; error?: string } | null;
    if (!response.ok || !payload?.ok) return { requested: false, reason: describeConnectorFailure(response.status, payload?.error, raw) };
    return { requested: true, created: Number(payload.created ?? 0) };
  } catch (error) {
    return { requested: false, reason: `Não foi possível acionar o conector Gmail agora. Tente novamente pela ação manual. (${String(error)})` };
  }
}

function parseJson(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return null; }
}

// Sem essa checagem, uma resposta que não é JSON (ex.: página de login do
// Google quando a implantação do Web App perde o acesso "Qualquer pessoa")
// virava sempre a mesma mensagem genérica, escondendo a causa real.
function describeConnectorFailure(status: number, error: string | undefined, raw: string): string {
  if (error) return error;
  const snippet = raw.trim().slice(0, 200);
  if (!snippet) return `O conector Gmail não confirmou a criação imediata (HTTP ${status}, resposta vazia).`;
  return `O conector Gmail não confirmou a criação imediata (HTTP ${status}): ${snippet}`;
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
    const raw = await response.text();
    const payload = parseJson(raw) as { ok?: boolean; confirmed?: number; error?: string } | null;
    if (!response.ok || !payload?.ok) return { requested: false, reason: describeConnectorFailure(response.status, payload?.error, raw) };
    return { requested: true, confirmed: Number(payload.confirmed ?? 0) };
  } catch (error) {
    return { requested: false, reason: `Não foi possível consultar o Gmail agora. (${String(error)})` };
  }
}
