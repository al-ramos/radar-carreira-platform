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
    description: "Marca uma análise preparada como concluída depois que a resposta foi entregue ao usuário. Não grava a conversa nem altera qualquer dado de vaga.",
    inputSchema: { id: z.string().uuid().describe("Identificador retornado por abrir_analise_preparada.") },
    annotations: { readOnlyHint: false },
  }, async ({ id }) => {
    const userId = await ownerUserId(env.DB);
    if (!userId) return text({ error: "Perfil da proprietária não encontrado." });
    const result = await env.DB.prepare("UPDATE triage_ai_reviews SET codex_status = 'completed', codex_completed_at = ? WHERE id = ? AND user_id = ? AND destination = 'codex' AND codex_status IN ('pending', 'claimed')").bind(Date.now(), id, userId).run();
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
type AiReviewQueueMessage = { kind: "ai-review"; reviewId: string; chunkId?: string; action: "chunk" | "consolidate" };

type QueueMessage = {
  body: TriageQueueMessage;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
};

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
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

    // A extensão APInfo é uma fonte push: assim que um lote de vagas é
    // persistido com sucesso, inicia a triagem no próprio Worker. Isso evita
    // depender de um cron separado e mantém o processamento após a coleta.
    if (url.pathname === "/api/collector/import/apinfo-extension" && request.method === "POST" && response.ok) {
      const result = await response.clone().json().catch(() => null) as { accepted?: unknown } | null;
      if (typeof result?.accepted === "number") {
        ctx.waitUntil(
          handler.fetch(new Request("https://collector.internal/api/triage/run", {
            method: "POST",
            headers: { "content-type": "application/json", "x-radar-collector-authenticated": "1" },
            body: JSON.stringify({ trigger: "schedule", sourceId: "apinfo-extension", dateScope: "received", aiMode: "ambiguous" }),
          }), env, ctx).catch(() => undefined),
        );
      }
    }

    return response;
  },
  async queue(batch: { messages: QueueMessage[] }, env: Env, ctx: ExecutionContext): Promise<void> {
    for (const message of batch.messages) {
      try {
        const payload = message.body as TriageQueueMessage | AiReviewQueueMessage;
        if ("kind" in payload && payload.kind === "ai-review") {
          const response = await handler.fetch(new Request("https://queue.internal/api/triage/ai-review/run", { method: "POST", headers: { "content-type": "application/json", "x-radar-ai-review-authenticated": "1" }, body: JSON.stringify(payload) }), env, ctx);
          if (response.ok) message.ack(); else message.retry({ delaySeconds: 15 });
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
        if (response.ok) message.ack();
        else message.retry({ delaySeconds: 15 });
      } catch {
        // Uma exceção isolada não pode interromper a entrega do lote inteiro.
        message.retry({ delaySeconds: 15 });
      }
    }
  },
};

export default worker;
