/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  COLLECTOR_SECRET: string;
  TRIAGE_QUEUE: {
    send(message: unknown): Promise<void>;
    sendBatch(messages: unknown[]): Promise<void>;
  };
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

type TriageQueueMessage = {
  userId: string;
  batchId: string;
  jobId: string;
  run: Record<string, unknown>;
};

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

    return handler.fetch(request, env, ctx);
  },
  async queue(batch: { messages: QueueMessage[] }, env: Env, ctx: ExecutionContext): Promise<void> {
    for (const message of batch.messages) {
      const payload = message.body;
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
    }
  },
};

export default worker;
