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
  run: { sourceId: string; dateScope: "received"; homePeriod: "all"; aiMode: "ambiguous" | "off"; batchSize: number };
  continuation: number;
};
type AiReviewQueueMessage = { kind: "ai-review"; reviewId: string; chunkId?: string; action: "chunk" | "consolidate" };
type ManualTriageBatchMessage = { kind: "manual-triage-batch"; items: TriageQueueMessage[] };

type QueueMessage = {
  body: TriageQueueMessage | ScheduledTriageQueueMessage | AiReviewQueueMessage | ManualTriageBatchMessage;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
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
    WHERE batch.status IN ('queued', 'running')
      AND COALESCE(batch.started_at, batch.created_at) <= ?
      AND EXISTS (SELECT 1 FROM triage_batch_items item WHERE item.batch_id = batch.id)
      AND NOT EXISTS (
        SELECT 1 FROM triage_batch_items item
        WHERE item.batch_id = batch.id AND item.status IN ('queued', 'processing')
      )
  `).bind(now, staleBefore).run();
  console.log(JSON.stringify({ event: "triage_batch_finalization", finalized: result.meta.changes }));
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
  const result = await env.DB.prepare(`
    SELECT i.batch_id, i.job_id, b.user_id
    FROM triage_batch_items i INNER JOIN triage_batches b ON b.id = i.batch_id
    WHERE b.trigger = 'manual' AND b.status IN ('queued', 'running')
      AND ((i.status = 'queued' AND i.updated_at <= ?) OR (i.status = 'processing' AND (i.lease_until IS NULL OR i.lease_until <= ?)))
    ORDER BY i.updated_at ASC LIMIT 100
  `).bind(staleBefore, now).all<{ batch_id: string; job_id: string; user_id: string }>();
  const recovered: TriageQueueMessage[] = [];
  for (const item of result.results) {
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
  const pending = await env.DB.prepare(`
    SELECT COUNT(*) AS total, COUNT(DISTINCT j.source_id) AS sources
    FROM draft_outbox o INNER JOIN jobs j ON j.id = o.job_id
    WHERE o.status = 'pending' AND j.source_id IS NOT NULL
  `).first<{ total: number; sources: number }>();
  const approvedWithoutOutbox = await env.DB.prepare(`
    SELECT COUNT(*) AS total, COUNT(DISTINCT j.source_id) AS sources
    FROM jobs j
    INNER JOIN user_job_analyses a ON a.job_id = j.id AND a.verdict = '✅'
    LEFT JOIN draft_outbox o ON o.job_id = j.id AND o.user_id = a.user_id
    WHERE j.status = 'active' AND o.id IS NULL AND j.source_id IS NOT NULL
  `).first<{ total: number; sources: number }>();
  const total = Number(pending?.total ?? 0) + Number(approvedWithoutOutbox?.total ?? 0);
  await recordAutomationHeartbeat(env, "draft-monitor", total ? "skipped" : "completed", startedAt,
    total ? `${total} item(ns) aguardam ação explícita no painel; recuperação automática desativada.` : null);
  console.log(JSON.stringify({ event: "draft_monitor", pending: Number(pending?.total ?? 0), pendingSources: Number(pending?.sources ?? 0), approvedWithoutOutbox: Number(approvedWithoutOutbox?.total ?? 0), approvedSources: Number(approvedWithoutOutbox?.sources ?? 0) }));
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
    const importEndpoints = Boolean(importMatch) || url.pathname === "/api/cron/email-import" || url.pathname === "/api/cron/collect" || url.pathname === "/api/admin/collect";
    if (importEndpoints && request.method === "POST" && response.ok) {
      const result = await response.clone().json().catch(() => null) as {
        accepted?: unknown; jobs?: unknown; outcomes?: Array<{ id?: unknown; inserted?: unknown; updated?: unknown }>;
      } | null;
      const sourceIds = new Set<string>();
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
    ctx.waitUntil(finalizeStalledTerminalTriageBatches(env).catch((error) => {
      console.error(JSON.stringify({ event: "triage_batch_finalization_failed", detail: error instanceof Error ? error.message.slice(0, 500) : "Falha ao finalizar lotes antigos" }));
    }));
    ctx.waitUntil(recoverStalledManualTriage(env).catch(async (error) => {
      const now = Date.now();
      const detail = error instanceof Error ? error.message.slice(0, 500) : "Falha ao recuperar a fila manual";
      console.error(JSON.stringify({ event: "triage_recovery_failed", detail }));
      await env.DB.prepare(`INSERT INTO automation_heartbeats (id, status, started_at, completed_at, error, updated_at)
        VALUES ('triage-recovery', 'failed', ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET status = excluded.status, started_at = excluded.started_at, completed_at = excluded.completed_at, error = excluded.error, updated_at = excluded.updated_at`
      ).bind(now, now, detail, now).run();
    }));
    ctx.waitUntil(observePendingDrafts(env).catch((error) => {
      console.error(JSON.stringify({ event: "draft_monitor_failed", detail: error instanceof Error ? error.message.slice(0, 500) : "Falha ao observar rascunhos" }));
    }));
    const scheduledDate = new Date(controller.scheduledTime);
    if (scheduledDate.getUTCHours() === 3 && scheduledDate.getUTCMinutes() < 2) {
      ctx.waitUntil(purgeExpiredPerformanceSamples(env, controller.scheduledTime).catch((error) => {
        console.error(JSON.stringify({ event: "performance_retention_failed", detail: error instanceof Error ? error.message.slice(0, 500) : "Falha ao limpar telemetria antiga" }));
      }));
    }
  },
  async queue(batch: { messages: QueueMessage[] }, env: Env, ctx: ExecutionContext): Promise<void> {
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
    ctx.waitUntil(finalizeStalledTerminalTriageBatches(env).catch((error) => {
      console.error(JSON.stringify({ event: "triage_batch_finalization_failed", detail: error instanceof Error ? error.message.slice(0, 500) : "Falha ao finalizar lotes antigos" }));
    }));
  },
};

export default worker;
