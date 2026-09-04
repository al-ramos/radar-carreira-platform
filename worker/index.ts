/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  COLLECTOR_SECRET: string;
  RADAR_CODEX_MCP_TOKEN: string;
  MANUAL_TRIAGE_QUEUE: {
    send(message: unknown): Promise<void>;
    sendBatch(messages: unknown[]): Promise<void>;
  };
  TRIAGE_QUEUE: {
    send(message: unknown): Promise<void>;
    sendBatch(messages: unknown[]): Promise<void>;
  };
  AI_REVIEW_QUEUE: { send(message: unknown): Promise<void>; sendBatch(messages: unknown[]): Promise<void>; };
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

const OWNER_EMAIL = "alexsandro.ramos@gmail.com";

type CodexQueueItem = {
  id: string;
  prompt: string;
  selection: string;
  codexStatus: string | null;
  createdAt: number;
  codexClaimedAt: number | null;
  codexCompletedAt: number | null;
  error: string | null;
};

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function sameSecret(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
}

async function ownerUserId(db: D1Database) {
  return (await db.prepare("SELECT user_id FROM profiles WHERE lower(email) = ? LIMIT 1").bind(OWNER_EMAIL).first<{ user_id: string }>())?.user_id ?? null;
}

function codexMcpServer(env: Env) {
  const server = new McpServer({ name: "radar-carreira", version: "1.0.0" });
  server.registerTool("listar_analises_pendentes", {
    title: "Listar análises pendentes do Radar",
    description: "Lista até 20 recortes de vagas preparados no portal para análise pelo Codex. Não altera triagem, candidaturas ou rascunhos.",
    inputSchema: { status: z.enum(["pending", "claimed", "completed", "failed", "all"]).optional().describe("Estado da fila; o padrão é pending.") },
    annotations: { readOnlyHint: true },
  }, async ({ status = "pending" }) => {
    const userId = await ownerUserId(env.DB);
    if (!userId) return text({ error: "Perfil da proprietária não encontrado." });
    const stateClause = status === "all" ? "" : " AND codex_status = ?";
    const statement = env.DB.prepare(`SELECT id, prompt, selection, codex_status, created_at, codex_claimed_at, codex_completed_at, error FROM triage_ai_reviews WHERE user_id = ? AND destination = 'codex'${stateClause} ORDER BY created_at DESC LIMIT 20`);
    const result = status === "all" ? await statement.bind(userId).all<CodexQueueItem>() : await statement.bind(userId, status).all<CodexQueueItem>();
    return text({ items: result.results.map((item) => {
      const selection = JSON.parse(item.selection) as { filters?: unknown; jobs?: Array<{ id: string; title: string; company: string }> };
      return { id: item.id, status: item.codexStatus, prompt: item.prompt, filters: selection.filters, jobs: selection.jobs?.map(({ id, title, company }) => ({ id, title, company })) ?? [], createdAt: item.createdAt, claimedAt: item.codexClaimedAt, completedAt: item.codexCompletedAt, error: item.error };
    }) });
  });
  server.registerTool("abrir_analise_preparada", {
    title: "Abrir análise preparada do Radar",
    description: "Obtém o snapshot completo da última análise pendente preparada no portal, incluindo perfil, filtros, instrução e vagas. Ao abrir uma pendência, marca-a como em análise.",
    inputSchema: { id: z.string().uuid().optional().describe("Identificador da análise. Omita para abrir a pendência mais recente.") },
    annotations: { readOnlyHint: false },
  }, async ({ id }) => {
    const userId = await ownerUserId(env.DB);
    if (!userId) return text({ error: "Perfil da proprietária não encontrado." });
    const item = id
      ? await env.DB.prepare("SELECT id, prompt, selection, codex_status, created_at, codex_claimed_at, codex_completed_at, error FROM triage_ai_reviews WHERE id = ? AND user_id = ? AND destination = 'codex' LIMIT 1").bind(id, userId).first<CodexQueueItem>()
      : await env.DB.prepare("SELECT id, prompt, selection, codex_status, created_at, codex_claimed_at, codex_completed_at, error FROM triage_ai_reviews WHERE user_id = ? AND destination = 'codex' AND codex_status = 'pending' ORDER BY created_at DESC LIMIT 1").bind(userId).first<CodexQueueItem>();
    if (!item) return text({ error: id ? "Análise não encontrada." : "Não há análise pendente preparada para o Codex." });
    if (item.codexStatus === "pending") await env.DB.prepare("UPDATE triage_ai_reviews SET codex_status = 'claimed', codex_claimed_at = ? WHERE id = ? AND user_id = ? AND codex_status = 'pending'").bind(Date.now(), item.id, userId).run();
    return text({ id: item.id, status: item.codexStatus === "pending" ? "claimed" : item.codexStatus, prompt: item.prompt, selection: JSON.parse(item.selection), createdAt: item.createdAt });
  });
  server.registerTool("concluir_analise_preparada", {
    title: "Concluir análise preparada do Radar",
    description: "Marca uma análise preparada como concluída depois que a resposta foi entregue ao usuário e registra a conclusão no sino do Radar. Não grava a conversa nem altera qualquer dado de vaga.",
    inputSchema: { id: z.string().uuid().describe("Identificador retornado por abrir_analise_preparada.") },
    annotations: { readOnlyHint: false },
  }, async ({ id }) => {
    const userId = await ownerUserId(env.DB);
    if (!userId) return text({ error: "Perfil da proprietária não encontrado." });
    const item = await env.DB.prepare("SELECT selection FROM triage_ai_reviews WHERE id = ? AND user_id = ? AND destination = 'codex' AND codex_status IN ('pending', 'claimed') LIMIT 1").bind(id, userId).first<{ selection: string }>();
    const completedAt = Date.now();
    const result = await env.DB.prepare("UPDATE triage_ai_reviews SET codex_status = 'completed', codex_completed_at = ? WHERE id = ? AND user_id = ? AND destination = 'codex' AND codex_status IN ('pending', 'claimed')").bind(completedAt, id, userId).run();
    if (result.meta.changes && item) {
      const selection = JSON.parse(item.selection) as { jobs?: unknown[] };
      const jobs = selection.jobs?.length ?? 0;
      await env.DB.prepare("INSERT INTO notifications (id, type, severity, title, body, link, metadata, read, created_at) VALUES (?, 'triage', 'success', ?, ?, '/?open=triagem', ?, 0, ?)")
        .bind(crypto.randomUUID(), "Triagem pelo Codex concluída", `${jobs} vaga${jobs === 1 ? "" : "s"} analisada${jobs === 1 ? "" : "s"} · resultado entregue nesta conversa`, JSON.stringify({ reviewId: id, source: "codex", jobs }), completedAt)
        .run();
    }
    return text({ id, status: result.meta.changes ? "completed" : "not_found_or_already_completed" });
  });
  return server;
}

async function handleCodexMcp(request: Request, env: Env) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || !env.RADAR_CODEX_MCP_TOKEN || !sameSecret(token, env.RADAR_CODEX_MCP_TOKEN)) return Response.json({ error: "Não autorizado" }, { status: 401 });
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  const server = codexMcpServer(env);
  await server.connect(transport);
  return transport.handleRequest(request);
}

type TriageQueueMessage = {
  userId: string;
  batchId: string;
  jobId: string;
  run: Record<string, unknown>;
};
type ScheduledTriageQueueMessage = {
  kind: "scheduled-triage";
  // `sourceId` ausente significa varredura global do backlog: toda vaga ativa
  // que ainda não tem triagem na revisão atual de perfil, regras e instruções.
  run: { sourceId?: string; dateScope: "received"; homePeriod: "all"; aiMode: "ambiguous" | "off"; batchSize: number };
  continuation: number;
};
type AiReviewQueueMessage = { kind: "ai-review"; reviewId: string; chunkId?: string; action: "chunk" | "consolidate" };
type ManualTriageBatchMessage = { kind: "manual-triage-batch"; items: TriageQueueMessage[] };

type QueueMessage = {
  id?: string;
  attempts?: number;
  body: TriageQueueMessage | ScheduledTriageQueueMessage | AiReviewQueueMessage | ManualTriageBatchMessage;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
};

/**
 * T1 — cada fila declara uma dead letter queue, mas nenhuma delas era
 * consumida: depois de max_retries a mensagem saía da fila principal e
 * desaparecia. Consumir a DLQ e persistir a mensagem é o que devolve a vaga à
 * visão de quem opera, com payload íntegro para reenfileirar depois.
 */
const DEAD_LETTER_QUEUES: Record<string, string> = {
  "radar-carreira-triage-manual-dlq": "radar-carreira-triage-manual",
  "radar-carreira-triage-dlq": "radar-carreira-triage",
  "radar-carreira-ai-review-dlq": "radar-carreira-ai-review",
};

const isRetryableQueueResponse = (response: Response) => response.status === 408 || response.status === 429 || response.status >= 500;

const QUEUE_DAILY_OPERATION_BUDGET = 7_500;
const QUEUE_OPERATIONS_PER_MESSAGE = 3;

class QueueBudgetExceededError extends Error {
  constructor(readonly resetAt: string) {
    super(`Limite preventivo diário da fila atingido. Nova tentativa após ${resetAt}.`);
    this.name = "QueueBudgetExceededError";
  }
}

const queueResetAt = (now = new Date()) => {
  const reset = new Date(now);
  reset.setUTCHours(24, 0, 0, 0);
  return reset.toISOString();
};

const queueErrorDetail = (error: unknown) => error instanceof Error ? error.message.slice(0, 500) : "Falha desconhecida na fila";
const isQueueQuotaError = (error: unknown) => error instanceof QueueBudgetExceededError
  || /daily (?:write )?operations limit|queue.*(?:quota|limit)|limite preventivo diário/i.test(queueErrorDetail(error));

async function recordAutomationHeartbeat(env: Env, id: string, status: "running" | "completed" | "failed" | "skipped", startedAt: number, error: string | null = null) {
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO automation_heartbeats (id, status, started_at, completed_at, error, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET status = excluded.status, started_at = excluded.started_at,
      completed_at = excluded.completed_at, error = excluded.error, updated_at = excluded.updated_at`
  ).bind(id, status, startedAt, status === "running" ? null : now, error, now).run();
}

/** Reserva write + read + delete antes de qualquer envio iniciado pelo Worker. */
async function reserveWorkerQueueMessages(env: Env, queue: string, messageCount: number) {
  const messages = Math.max(0, Math.floor(messageCount));
  if (!messages) return;
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const configured = await env.DB.prepare("SELECT queue_daily_operation_budget AS budget FROM platform_settings WHERE id = 'global' LIMIT 1").first<{ budget: number | null }>();
  const budget = Math.max(1_000, Math.min(10_000, configured?.budget ?? QUEUE_DAILY_OPERATION_BUDGET));
  const operations = messages * QUEUE_OPERATIONS_PER_MESSAGE;
  await env.DB.prepare(`INSERT INTO queue_daily_usage (day_utc, queue, reserved_operations, emitted_messages, retry_operations, updated_at)
    VALUES (?, '__total__', 0, 0, 0, ?) ON CONFLICT(day_utc, queue) DO NOTHING`).bind(day, now).run();
  const reserved = await env.DB.prepare(`UPDATE queue_daily_usage
    SET reserved_operations = reserved_operations + ?, emitted_messages = emitted_messages + ?, updated_at = ?
    WHERE day_utc = ? AND queue = '__total__' AND reserved_operations <= ?`
  ).bind(operations, messages, now, day, budget - operations).run();
  if (!reserved.meta.changes) throw new QueueBudgetExceededError(queueResetAt(new Date(now)));
  await env.DB.prepare(`INSERT INTO queue_daily_usage (day_utc, queue, reserved_operations, emitted_messages, retry_operations, updated_at)
    VALUES (?, ?, ?, ?, 0, ?)
    ON CONFLICT(day_utc, queue) DO UPDATE SET reserved_operations = reserved_operations + excluded.reserved_operations,
      emitted_messages = emitted_messages + excluded.emitted_messages, updated_at = excluded.updated_at`
  ).bind(day, queue, operations, messages, now).run();
}

async function dispatchScheduledTriage(env: Env, messages: ScheduledTriageQueueMessage[]) {
  if (!messages.length) return;
  const startedAt = Date.now();
  try {
    await reserveWorkerQueueMessages(env, "radar-carreira-triage", messages.length);
    await Promise.all(messages.map((message) => env.TRIAGE_QUEUE.send(message)));
    await recordAutomationHeartbeat(env, "triage-dispatch", "completed", startedAt);
    console.log(JSON.stringify({ event: "triage_dispatch", status: "completed", messages: messages.length }));
  } catch (error) {
    const detail = queueErrorDetail(error);
    await recordAutomationHeartbeat(env, "triage-dispatch", "failed", startedAt, detail);
    console.error(JSON.stringify({ event: "triage_dispatch", status: "failed", messages: messages.length, detail }));
    throw error;
  }
}

/**
 * Varredura de recuperação do backlog de triagem.
 *
 * A triagem agendada por fonte só é disparada quando uma coleta ou importação
 * daquela fonte responde com sucesso. Isso cobre vaga nova, mas não cobre a
 * invalidação: quando o perfil canônico ou a revisão das regras muda, toda
 * vaga ativa já coletada passa a precisar de triagem nova e nenhuma
 * importação volta a acontecer para as fontes que pararam de produzir. Sem
 * esta varredura o veredito oficial dessas vagas congela em uma revisão
 * antiga — e a fila do Codex chega a receber recortes cujo veredito foi
 * calculado com um perfil que não existe mais.
 *
 * A varredura não usa IA (`aiMode: "off"`): recompor o veredito determinístico
 * é o que restaura a consistência, e o backlog pode ter milhares de vagas.
 * O tamanho do lote é o mesmo parâmetro operacional da agenda, e a rota
 * devolve `hasMore` para o consumidor encadear as continuações.
 */
async function dispatchTriageBacklogSweep(env: Env) {
  const settings = await env.DB.prepare("SELECT scheduled_triage_enabled AS enabled, scheduled_triage_batch_size AS batchSize FROM platform_settings WHERE id = 'global' LIMIT 1").first<{ enabled: number | null; batchSize: number | null }>();
  if (!settings?.enabled) return;
  const startedAt = Date.now();
  try {
    await dispatchScheduledTriage(env, [{
      kind: "scheduled-triage",
      run: { dateScope: "received", homePeriod: "all", aiMode: "off", batchSize: Math.max(1, Math.min(1_000, Math.floor(settings.batchSize ?? 100))) },
      continuation: 0,
    }]);
    await recordAutomationHeartbeat(env, "triage-backlog-sweep", "completed", startedAt);
  } catch (error) {
    await recordAutomationHeartbeat(env, "triage-backlog-sweep", "failed", startedAt, queueErrorDetail(error));
    throw error;
  }
}

async function recordQueueRetry(env: Env, queue: string) {
  const now = Date.now(), day = new Date(now).toISOString().slice(0, 10);
  for (const key of ["__total__", queue]) await env.DB.prepare(`
    INSERT INTO queue_daily_usage (day_utc, queue, reserved_operations, emitted_messages, retry_operations, updated_at)
    VALUES (?, ?, 0, 0, 1, ?)
    ON CONFLICT(day_utc, queue) DO UPDATE SET retry_operations = retry_operations + 1, updated_at = excluded.updated_at
  `).bind(day, key, now).run();
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const STALE_MANUAL_TRIAGE_MS = 2 * 60_000;
const PERFORMANCE_RETENTION_MS = 30 * 24 * 36e5;

/**
 * Repara lotes cuja última etapa de persistência foi interrompida depois que
 * todos os itens já chegaram a um estado terminal. O atraso evita disputar o
 * status com uma execução ainda ativa.
 */
async function finalizeStalledTerminalTriageBatches(env: Env) {
  const now = Date.now();
  const staleBefore = now - STALE_MANUAL_TRIAGE_MS;
  // O UPDATE global anterior avaliava subconsultas contra todos os lotes e
  // itens (8,2 mil rows_read por execução no incidente). A recuperação é um
  // fallback: localiza poucos lotes antigos e usa batch_id, que é indexado.
  const candidates = await env.DB.prepare(`
    SELECT id FROM triage_batches
    WHERE status IN ('queued', 'running')
      AND COALESCE(started_at, created_at) <= ?
    ORDER BY created_at ASC LIMIT 20
  `).bind(staleBefore).all<{ id: string }>();
  let finalized = 0;
  for (const batch of candidates.results) {
    const result = await env.DB.prepare(`
    UPDATE triage_batches AS batch
    SET status = CASE
          WHEN EXISTS (SELECT 1 FROM triage_batch_items item WHERE item.batch_id = batch.id AND item.status = 'failed') THEN 'failed'
          ELSE 'completed'
        END,
        completed_at = ?,
        error = CASE
          WHEN EXISTS (SELECT 1 FROM triage_batch_items item WHERE item.batch_id = batch.id AND item.status = 'failed')
            THEN COALESCE(batch.error, 'Uma ou mais vagas falharam; consulte o log do lote.')
          ELSE NULL
        END
    WHERE batch.id = ? AND batch.status IN ('queued', 'running')
      AND NOT EXISTS (
        SELECT 1 FROM triage_batch_items item
        WHERE item.batch_id = batch.id AND item.status IN ('queued', 'processing')
      )
  `).bind(now, batch.id).run();
    finalized += result.meta.changes ?? 0;
  }
  console.log(JSON.stringify({ event: "triage_batch_finalization", candidates: candidates.results.length, finalized }));
}

async function purgeExpiredPerformanceSamples(env: Env, scheduledAt: number) {
  const cutoff = scheduledAt - PERFORMANCE_RETENTION_MS;
  const result = await env.DB.prepare("DELETE FROM performance_samples WHERE created_at < ?").bind(cutoff).run();
  console.log(JSON.stringify({ event: "performance_retention", deleted: result.meta.changes, cutoff }));
}

/** Reenvia somente itens manuais sem progresso, sem tocar em reservas válidas. */
async function recoverStalledManualTriage(env: Env) {
  const now = Date.now();
  const staleBefore = now - STALE_MANUAL_TRIAGE_MS;
  // A consulta anterior começava por todos os itens e fazia JOIN + OR a cada
  // cron. No acervo atual isso leu, em média, 12,9 mil linhas por execução e
  // somou mais de 9,2 milhões de rows_read em um dia. Primeiro localizamos os
  // poucos lotes manuais ativos e depois usamos o índice (batch_id, status).
  const activeBatches = await env.DB.prepare(`
    SELECT id, user_id FROM triage_batches
    WHERE trigger = 'manual' AND status IN ('queued', 'running')
    ORDER BY created_at DESC LIMIT 10
  `).all<{ id: string; user_id: string }>();
  const stalled: Array<{ batch_id: string; job_id: string; user_id: string }> = [];
  for (const batch of activeBatches.results) {
    const remaining = 100 - stalled.length;
    if (remaining <= 0) break;
    const queued = await env.DB.prepare(`
      SELECT job_id FROM triage_batch_items
      WHERE batch_id = ? AND status = 'queued' AND updated_at <= ?
      ORDER BY updated_at ASC LIMIT ?
    `).bind(batch.id, staleBefore, remaining).all<{ job_id: string }>();
    stalled.push(...queued.results.map((item) => ({ batch_id: batch.id, job_id: item.job_id, user_id: batch.user_id })));
    const processingRemaining = 100 - stalled.length;
    if (processingRemaining <= 0) break;
    const processing = await env.DB.prepare(`
      SELECT job_id FROM triage_batch_items
      WHERE batch_id = ? AND status = 'processing' AND (lease_until IS NULL OR lease_until <= ?)
      ORDER BY updated_at ASC LIMIT ?
    `).bind(batch.id, now, processingRemaining).all<{ job_id: string }>();
    stalled.push(...processing.results.map((item) => ({ batch_id: batch.id, job_id: item.job_id, user_id: batch.user_id })));
  }
  const recovered: TriageQueueMessage[] = [];
  for (const item of stalled) {
    const update = await env.DB.prepare(`
      UPDATE triage_batch_items SET status = 'queued', lease_owner = NULL, lease_until = NULL, error = NULL, updated_at = ?
      WHERE batch_id = ? AND job_id = ?
        AND ((status = 'queued' AND updated_at <= ?) OR (status = 'processing' AND (lease_until IS NULL OR lease_until <= ?)))
    `).bind(now, item.batch_id, item.job_id, staleBefore, now).run();
    if (update.meta.changes) recovered.push({ userId: item.user_id, batchId: item.batch_id, jobId: item.job_id, run: { trigger: "portal", batchSize: 1, aiMode: "off", createDrafts: false } });
  }
  // `sendBatch` espera envelopes com a propriedade `body`. Enviar o payload
  // diretamente fazia a recuperação agendada falhar com “Message body cannot
  // be undefined”, deixando itens manuais presos apesar de terem sido
  // reenfileirados no banco.
  for (let index = 0; index < recovered.length; index += 100) {
    const messages = recovered.slice(index, index + 100).map((body) => ({ body }));
    await reserveWorkerQueueMessages(env, "radar-carreira-triage-manual", messages.length);
    await env.MANUAL_TRIAGE_QUEUE.sendBatch(messages);
  }
  await env.DB.prepare(`INSERT INTO automation_heartbeats (id, status, started_at, completed_at, error, updated_at)
    VALUES ('triage-recovery', 'completed', ?, ?, NULL, ?)
    ON CONFLICT(id) DO UPDATE SET status = excluded.status, started_at = excluded.started_at, completed_at = excluded.completed_at, error = NULL, updated_at = excluded.updated_at`
  ).bind(now, now, now).run();
  console.log(JSON.stringify({ event: "triage_recovery", recovered: recovered.length }));
}

/**
 * Rascunhos são apenas observados pelo cron. A retomada automática anterior
 * reenfileirava as mesmas fontes a cada dois minutos e podia esgotar a cota
 * mesmo sem vagas novas. A correção continua disponível pela ação explícita
 * no painel, sem criar ou enviar rascunhos silenciosamente.
 */
async function observePendingDrafts(env: Env) {
  const startedAt = Date.now();
  // O cron é um observador, não uma fila de recuperação. Contar aprovações
  // sem outbox varria jobs + análises + outbox a cada dois minutos (4,1 M de
  // rows_read/dia) sem mudar o estado. O painel detalhado continua oferecendo
  // essa visão quando a pessoa o abre; o heartbeat periódico usa só a outbox.
  // R2 — a contagem sozinha não distingue "3 pendentes ha dez minutos", que e
  // operação normal, de "3 pendentes há seis dias", que são três candidaturas
  // perdidas. O MIN(created_at) vem na mesma consulta, sem custo adicional de
  // leitura.
  const pending = await env.DB.prepare(
    `SELECT COUNT(*) AS total, MIN(created_at) AS oldest FROM draft_outbox WHERE status = 'pending'`,
  ).first<{ total: number; oldest: number | null }>();
  const total = Number(pending?.total ?? 0);
  const oldest = pending?.oldest ? Number(pending.oldest) : null;
  const ageHours = oldest ? Math.floor((Date.now() - oldest) / 36e5) : null;
  const age = ageHours === null ? "" : ageHours >= 24
    ? ` A mais antiga espera há ${Math.floor(ageHours / 24)} dia(s).`
    : ageHours >= 1 ? ` A mais antiga espera há ${ageHours} hora(s).` : " A mais antiga chegou há menos de uma hora.";
  await recordAutomationHeartbeat(env, "draft-monitor", total ? "skipped" : "completed", startedAt,
    total ? `${total} item(ns) aguardam ação explícita no painel; recuperação automática desativada.${age}` : null);
  console.log(JSON.stringify({ event: "draft_monitor", pending: total, oldestPendingAgeHours: ageHours, approvedRecovery: "explicit_only" }));
}

/**
 * A DLQ não transporta o erro da tentativa que falhou — só a mensagem. O que
 * dá para registrar com honestidade é a origem, o alvo, quantas tentativas
 * houve e o payload; o motivo fica no log do Worker, encontrável pelo id.
 */
async function recordDeadLetters(env: Env, queue: string, origin: string, messages: QueueMessage[]) {
  const now = Date.now();
  for (const message of messages) {
    try {
      const payload = message.body as {
        kind?: string; jobId?: string; batchId?: string; userId?: string; reviewId?: string;
        items?: Array<{ userId?: string; batchId?: string }>;
      };
      const kind = typeof payload?.kind === "string" ? payload.kind : "triage";
      const id = message.id ?? crypto.randomUUID();
      const jobId = payload?.jobId ?? (kind === "ai-review" ? payload?.reviewId ?? null : null);
      const userId = payload?.userId ?? payload?.items?.[0]?.userId ?? null;
      const batchId = payload?.batchId ?? payload?.items?.[0]?.batchId ?? null;
      await env.DB.prepare(
        `INSERT INTO queue_dead_letters (id, queue, kind, job_id, batch_id, user_id, attempts, last_error, payload, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 'pending', ?, ?)
         ON CONFLICT(id) DO UPDATE SET attempts = excluded.attempts, updated_at = excluded.updated_at`,
      ).bind(id, origin, kind, jobId, batchId, userId, message.attempts ?? 0, JSON.stringify(message.body).slice(0, 20_000), now, now).run();
      console.error(JSON.stringify({ event: "queue_dead_letter", queue, origin, id, kind, jobId, attempts: message.attempts ?? 0 }));
      message.ack();
    } catch (error) {
      // Persistir falhou: devolver à DLQ é melhor que perder o registro.
      console.error(JSON.stringify({ event: "queue_dead_letter_record_failed", queue, detail: error instanceof Error ? error.message.slice(0, 300) : "erro desconhecido" }));
      message.retry({ delaySeconds: 300 });
    }
  }
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/mcp/radar") return handleCodexMcp(request, env);
    const protectedCronPaths = ["/api/cron/collect", "/api/cron/enrich", "/api/cron/lifecycle"];
    const triageSchedulePath = url.pathname === "/api/triage/run";
    const originalInternalHeader = request.headers.get("x-radar-collector-authenticated");
    const headers = new Headers(request.headers);
    // Este cabeçalho só é confiável quando o próprio Worker o injeta após
    // validar COLLECTOR_SECRET. Remove qualquer tentativa vinda da internet.
    headers.delete("x-radar-collector-authenticated");
    // Esta autenticação existe somente entre o consumidor da Queue e o
    // handler interno. Nunca aceite os cabeçalhos enviados pela internet.
    headers.delete("x-radar-triage-queue-authenticated");
    headers.delete("x-radar-triage-user-id");
    headers.delete("x-radar-ai-review-authenticated");

    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    // A mesma rota aceita sessões do portal. Somente uma chamada com bearer
    // é tratada como agenda interna; sem bearer ela segue para autenticação
    // normal do aplicativo, mas sempre com o cabeçalho interno removido.
    if (protectedCronPaths.includes(url.pathname) || (triageSchedulePath && token)) {
      if (!token || token !== env.COLLECTOR_SECRET)
        return Response.json({ error: "Não autorizado" }, { status: 401 });

      headers.delete("authorization");
      headers.set("x-radar-collector-authenticated", "1");
      request = new Request(request, { headers });
    } else if (originalInternalHeader) {
      request = new Request(request, { headers });
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    const response = await handler.fetch(request, env, ctx);

    // Toda fonte que concluir uma importação inicia a triagem no próprio
    // Worker. O recorte "all" é intencional: cada fonte também escoa seu
    // estoque de vagas ativas ainda não triadas, em lotes continuáveis.
    // Assim, fontes pull, extensões e Gmail seguem o mesmo fluxo.
    const importMatch = /^\/api\/collector\/import\/([^/]+)$/.exec(url.pathname);
    const linkedinExtensionImport = url.pathname === "/api/collector/import";
    const importEndpoints = linkedinExtensionImport || Boolean(importMatch) || url.pathname === "/api/cron/email-import" || url.pathname === "/api/cron/collect" || url.pathname === "/api/admin/collect";
    if (importEndpoints && request.method === "POST" && response.ok) {
      const result = await response.clone().json().catch(() => null) as {
        accepted?: unknown; jobs?: unknown; outcomes?: Array<{ id?: unknown; inserted?: unknown; updated?: unknown }>;
      } | null;
      const sourceIds = new Set<string>();
      if (linkedinExtensionImport && typeof result?.accepted === "number" && result.accepted > 0) sourceIds.add("linkedin-extension");
      if (importMatch && typeof result?.accepted === "number" && result.accepted > 0) sourceIds.add(importMatch[1]);
      if (url.pathname === "/api/cron/email-import" && typeof result?.jobs === "number" && result.jobs > 0) sourceIds.add("gmail-radarvagas");
      // A coleta de uma fonte é também a oportunidade diária de escoar o
      // respectivo backlog ainda não triado. Não condicione o disparo a
      // linhas novas: um lote anterior pode ter parado antes da triagem e a
      // fonte não necessariamente terá mudanças no ciclo seguinte.
      for (const outcome of result?.outcomes ?? []) {
        if (typeof outcome.id === "string") sourceIds.add(outcome.id);
      }
      if (sourceIds.size) {
        const messages = [...sourceIds].map((sourceId) => ({
          kind: "scheduled-triage",
          // A rota lê o limite configurado pelo administrador antes de executar.
          run: { sourceId, dateScope: "received", homePeriod: "all", aiMode: "ambiguous", batchSize: 100 },
          continuation: 0,
        } satisfies ScheduledTriageQueueMessage));
        // A falha fica persistida no heartbeat antes de ser absorvida aqui;
        // a resposta da importação já concluída não deve ser revertida.
        ctx.waitUntil(dispatchScheduledTriage(env, messages).catch(() => undefined));
      }
    }

    return response;
  },
  async scheduled(controller: { scheduledTime: number }, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(recoverStalledManualTriage(env).catch(async (error) => {
      const now = Date.now();
      const detail = error instanceof Error ? error.message.slice(0, 500) : "Falha ao recuperar a fila manual";
      console.error(JSON.stringify({ event: "triage_recovery_failed", detail }));
      await env.DB.prepare(`INSERT INTO automation_heartbeats (id, status, started_at, completed_at, error, updated_at)
        VALUES ('triage-recovery', 'failed', ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET status = excluded.status, started_at = excluded.started_at, completed_at = excluded.completed_at, error = excluded.error, updated_at = excluded.updated_at`
      ).bind(now, now, detail, now).run();
    }));
    const scheduledDate = new Date(controller.scheduledTime);
    // A observação de rascunhos não muda estado e não precisa varrer o banco
    // na mesma frequência da recuperação de leases. Uma execução por hora é
    // suficiente para o painel e mantém uma margem ampla na cota gratuita.
    if (scheduledDate.getUTCMinutes() < 5) {
      ctx.waitUntil(finalizeStalledTerminalTriageBatches(env).catch((error) => {
        console.error(JSON.stringify({ event: "triage_batch_finalization_failed", detail: error instanceof Error ? error.message.slice(0, 500) : "Falha ao finalizar lotes antigos" }));
      }));
      ctx.waitUntil(observePendingDrafts(env).catch((error) => {
        console.error(JSON.stringify({ event: "draft_monitor_failed", detail: error instanceof Error ? error.message.slice(0, 500) : "Falha ao observar rascunhos" }));
      }));
    }
    // Um tique por hora (o cron dispara a cada 15 minutos). A varredura só
    // enfileira uma mensagem; as continuações vêm do consumidor, sob o mesmo
    // orçamento diário de operações de fila.
    const sweepMinute = scheduledDate.getUTCMinutes();
    if (sweepMinute >= 30 && sweepMinute < 45) {
      ctx.waitUntil(dispatchTriageBacklogSweep(env).catch((error) => {
        console.error(JSON.stringify({ event: "triage_backlog_sweep_failed", detail: error instanceof Error ? error.message.slice(0, 500) : "Falha ao varrer o backlog de triagem" }));
      }));
    }
    if (scheduledDate.getUTCHours() === 3 && scheduledDate.getUTCMinutes() < 2) {
      ctx.waitUntil(purgeExpiredPerformanceSamples(env, controller.scheduledTime).catch((error) => {
        console.error(JSON.stringify({ event: "performance_retention_failed", detail: error instanceof Error ? error.message.slice(0, 500) : "Falha ao limpar telemetria antiga" }));
      }));
    }
  },
  async queue(batch: { queue?: string; messages: QueueMessage[] }, env: Env, ctx: ExecutionContext): Promise<void> {
    const deadLetterOrigin = batch.queue ? DEAD_LETTER_QUEUES[batch.queue] : undefined;
    if (deadLetterOrigin) {
      await recordDeadLetters(env, batch.queue as string, deadLetterOrigin, batch.messages);
      return;
    }
    for (const message of batch.messages) {
      try {
        const payload = message.body;
        if ("kind" in payload && payload.kind === "manual-triage-batch") {
          let retry = false;
          for (const item of payload.items) {
            const response = await handler.fetch(new Request("https://queue.internal/api/triage/run", {
              method: "POST", headers: { "content-type": "application/json", "x-radar-triage-queue-authenticated": "1", "x-radar-triage-user-id": item.userId },
              body: JSON.stringify({ ...item.run, batchId: item.batchId, jobId: item.jobId }),
            }), env, ctx);
            retry ||= isRetryableQueueResponse(response);
          }
          if (retry) { await recordQueueRetry(env, "radar-carreira-triage-manual"); message.retry({ delaySeconds: 15 }); }
          else message.ack();
          continue;
        }
        if ("kind" in payload && payload.kind === "ai-review") {
          const response = await handler.fetch(new Request("https://queue.internal/api/triage/ai-review/run", { method: "POST", headers: { "content-type": "application/json", "x-radar-ai-review-authenticated": "1" }, body: JSON.stringify(payload) }), env, ctx);
          if (response.ok || !isRetryableQueueResponse(response)) message.ack(); else { await recordQueueRetry(env, "radar-carreira-ai-review"); message.retry({ delaySeconds: 15 }); }
          continue;
        }
        if ("kind" in payload && payload.kind === "scheduled-triage") {
          const response = await handler.fetch(new Request("https://queue.internal/api/triage/run", {
            method: "POST",
            headers: { "content-type": "application/json", "x-radar-collector-authenticated": "1", "x-radar-triage-user-id": (await ownerUserId(env.DB)) ?? "" },
            body: JSON.stringify({ trigger: "schedule", ...payload.run }),
          }), env, ctx);
          const result = await response.clone().json().catch(() => null) as { hasMore?: unknown } | null;
          if (!response.ok) {
            if (isRetryableQueueResponse(response)) { await recordQueueRetry(env, "radar-carreira-triage"); message.retry({ delaySeconds: 15 }); }
            else message.ack();
            continue;
          }
          // A primeira rodada usa IA somente para as ambiguidades. O próprio
          // servidor informa se há mais vagas sob o limite configurado.
          if (result?.hasMore === true) {
            await dispatchScheduledTriage(env, [{
              kind: "scheduled-triage",
              run: { ...payload.run, aiMode: "off" },
              continuation: payload.continuation + 1,
            } satisfies ScheduledTriageQueueMessage]);
          }
          message.ack();
          continue;
        }
        const response = await handler.fetch(new Request("https://queue.internal/api/triage/run", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-radar-triage-queue-authenticated": "1",
            "x-radar-triage-user-id": payload.userId,
          },
          body: JSON.stringify({ ...payload.run, batchId: payload.batchId, jobId: payload.jobId }),
        }), env, ctx);
        if (response.ok || !isRetryableQueueResponse(response)) message.ack();
        else { await recordQueueRetry(env, "radar-carreira-triage-manual"); message.retry({ delaySeconds: 15 }); }
      } catch (error) {
        if (isQueueQuotaError(error)) {
          // O item segue pendente no D1. Fazer retry automático durante o
          // bloqueio apenas multiplicaria leituras e deletes da mesma cota.
          message.ack();
          continue;
        }
        // Uma exceção isolada não pode interromper a entrega do lote inteiro.
        await recordQueueRetry(env, "unknown");
        message.retry({ delaySeconds: 15 });
      }
    }
  },
};

export default worker;
