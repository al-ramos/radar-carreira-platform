import { and, desc, eq, gte } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db/index";
import { jobSources, jobs } from "../../../db/schema";
import { JOB_AREAS } from "../../../lib/job-area";
import { buildMarketIntelligence, type MarketPeriod } from "../../../lib/market-intelligence";

export const dynamic = "force-dynamic";

const MAX_MARKET_JOBS = 10_000;
const PERIODS = new Set<MarketPeriod>(["7", "30", "90", "all"]);

const periodCutoff = (period: MarketPeriod) => {
  if (period === "all") return null;
  return new Date(Date.now() - Number(period) * 86_400_000);
};

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });

  const url = new URL(request.url);
  const requestedPeriod = url.searchParams.get("period") ?? "30";
  const period = PERIODS.has(requestedPeriod as MarketPeriod) ? requestedPeriod as MarketPeriod : "30";
  const requestedArea = (url.searchParams.get("area") ?? "all").trim();
  const area = requestedArea === "all" || JOB_AREAS.some(option => option.id === requestedArea) ? requestedArea : "all";
  const source = (url.searchParams.get("source") ?? "all").trim() || "all";
  const cutoff = periodCutoff(period);

  const rows = await getDb()
    .select({
      id: jobs.id,
      company: jobs.company,
      location: jobs.location,
      workMode: jobs.workMode,
      stack: jobs.stack,
      status: jobs.status,
      roleArea: jobs.roleArea,
      sourceId: jobs.sourceId,
      sourceName: jobSources.name,
      publishedAt: jobs.publishedAt,
      sourcePublishedAt: jobs.sourcePublishedAt,
      firstSeenAt: jobs.firstSeenAt,
      description: jobs.description,
    })
    .from(jobs)
    .leftJoin(jobSources, eq(jobs.sourceId, jobSources.id))
    .where(and(
      cutoff ? gte(jobs.firstSeenAt, cutoff) : undefined,
      area === "all" ? undefined : eq(jobs.roleArea, area),
    ))
    .orderBy(desc(jobs.firstSeenAt))
    .limit(MAX_MARKET_JOBS + 1);
  const limited = rows.length > MAX_MARKET_JOBS;
  const report = buildMarketIntelligence(rows.slice(0, MAX_MARKET_JOBS), { period, area, source }, {
    limited,
    sampleLimit: MAX_MARKET_JOBS,
  });
  return NextResponse.json(report, { headers: { "cache-control": "no-store" } });
}
