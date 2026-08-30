import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { performanceSamples } from "../../../../db/schema";

export const dynamic = "force-dynamic";
const metricLimits: ReadonlyMap<string, number> = new Map([
  ["ttfb", 120_000], ["fcp", 120_000], ["lcp", 120_000], ["cls", 10], ["inp", 120_000],
  ["jobs_api_duration", 120_000], ["jobs_api_server", 120_000], ["jobs_api_bytes", 10_000_000],
  ["jobs_meta_duration", 120_000], ["jobs_meta_server", 120_000], ["jobs_meta_bytes", 10_000_000],
]);

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return new NextResponse(null, { status: 204 });
  const body = await request.json().catch(() => null) as { route?: unknown; metrics?: unknown } | null;
  if (body?.route !== "dashboard" || !Array.isArray(body.metrics)) return NextResponse.json({ error: "Métrica inválida" }, { status: 400 });
  const metrics = body.metrics
    .filter((item): item is { name: string; value: number } => Boolean(item) && typeof item === "object" && typeof (item as { name?: unknown }).name === "string" && typeof (item as { value?: unknown }).value === "number")
    .filter((item) => {
      const limit = metricLimits.get(item.name);
      return limit !== undefined && Number.isFinite(item.value) && item.value >= 0 && item.value <= limit;
    })
    .slice(0, metricLimits.size);
  if (metrics.length) {
    const createdAt = new Date();
    await getDb().insert(performanceSamples).values(metrics.map((metric) => ({
      id: crypto.randomUUID(), route: "dashboard", metric: metric.name, value: metric.value, createdAt,
    })));
    console.log(JSON.stringify({ event: "client_performance", route: "dashboard", metrics }));
  }
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
