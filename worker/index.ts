/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  COLLECTOR_SECRET: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

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
};

export default worker;
