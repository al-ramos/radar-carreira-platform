import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";

export const dynamic = "force-dynamic";
const allowedMetrics = new Set(["ttfb", "fcp", "lcp", "cls", "inp"]);

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return new NextResponse(null, { status: 204 });
  const body = await request.json().catch(() => null) as { route?: unknown; metrics?: unknown } | null;
  if (body?.route !== "dashboard" || !Array.isArray(body.metrics)) return NextResponse.json({ error: "Métrica inválida" }, { status: 400 });
  const metrics = body.metrics
    .filter((item): item is { name: string; value: number } => Boolean(item) && typeof item === "object" && typeof (item as { name?: unknown }).name === "string" && typeof (item as { value?: unknown }).value === "number")
    .filter((item) => allowedMetrics.has(item.name) && Number.isFinite(item.value) && item.value >= 0 && item.value <= 120_000)
    .slice(0, 5);
  if (metrics.length) console.log(JSON.stringify({ event: "client_performance", route: "dashboard", metrics }));
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
