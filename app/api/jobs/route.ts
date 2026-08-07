import { and, count, desc, eq, gte, like, notLike, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db/index";
import { jobs, platformSettings, profiles } from "../../../db/schema";
import { matchesSelectedSeniority, scoreJob } from "../../../lib/scoring";
import { inferTechnologyStack } from "../../../lib/technology-stack";
import { allowedWorkModes, listFromStored } from "../../../lib/profile-options";

export const dynamic = "force-dynamic";
const parse = (value: string) => {
  try {
    return JSON.parse(value) as string[];
  } catch {
    return [];
  }
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 250);
    const offset = (page - 1) * limit;
    const requestedPeriod = url.searchParams.get("period");
    const configuredPeriod =
      (
        await getDb()
          .select({ defaultPeriod: platformSettings.defaultPeriod })
          .from(platformSettings)
          .where(eq(platformSettings.id, "global"))
          .limit(1)
      )[0]?.defaultPeriod ?? "24";
    const period = new Set(["24", "72", "168", "all"]).has(
      requestedPeriod ?? "",
    )
      ? requestedPeriod!
      : configuredPeriod;
    const hours =
      period === "all"
        ? null
        : Math.max(1, Math.min(Number(period) || 24, 24 * 30));
    const user = await getChatGPTUser();
    let profile: null | typeof profiles.$inferSelect = null;
    if (user)
      profile =
        (
          await getDb()
            .select()
            .from(profiles)
            .where(eq(profiles.userId, user.userId))
            .limit(1)
        )[0] ?? null;

    const cutoff = hours ? new Date(Date.now() - hours * 36e5) : null;
    // baseCondition: período + status — sem filtro de fonte
    const baseCondition = cutoff
      ? and(eq(jobs.status, "active"), gte(jobs.publishedAt, cutoff))
      : eq(jobs.status, "active");
    // Uma vaga é considerada "do LinkedIn" quando sua URL aponta para o
    // LinkedIn — mesmo padrão já usado para localizar a descrição oficial
    // em app/api/jobs/detail/route.ts. Isso cobre tanto as vagas trazidas
    // pela extensão do LinkedIn quanto as importadas via alerta do Gmail.
    const linkedInCondition = and(baseCondition, like(jobs.url, "%linkedin.com%"));
    const otherCondition = and(baseCondition, notLike(jobs.url, "%linkedin.com%"));
    // sourceType: filtro de fonte aplicado ANTES do LIMIT/OFFSET
    const sourceType = url.searchParams.get("sourceType") ?? "all";
    const condition =
      sourceType === "linkedin"
        ? linkedInCondition
        : sourceType === "other"
          ? otherCondition
          : baseCondition;
    const [rows, totals, linkedInTotals, baseTotals, sourcesResult] = await Promise.all([
      getDb()
        .select()
        .from(jobs)
        .where(condition)
        .orderBy(desc(jobs.publishedAt))
        .limit(limit)
        .offset(offset),
      getDb().select({ total: count() }).from(jobs).where(condition),
      getDb().select({ total: count() }).from(jobs).where(linkedInCondition),
      getDb().select({ total: count() }).from(jobs).where(baseCondition),
      getDb()
        .select({ count: sql<number>`count(distinct ${jobs.sourceId})` })
        .from(jobs)
        .where(baseCondition),
    ]);
    const totalCount = Number(totals[0]?.total ?? 0);
    const baseTotal = Number(baseTotals[0]?.total ?? 0);
    const totalLinkedIn = Number(linkedInTotals[0]?.total ?? 0);
    const totalOtherSources = Math.max(0, baseTotal - totalLinkedIn);
    const sourcesCount = Number(sourcesResult[0]?.count ?? 0);
    // Deduplicação por título+empresa (vagas da mesma empresa em fontes diferentes)
    const seen = new Set<string>();
    const dedupedRows = rows.filter((job) => {
      const key = `${job.title.toLowerCase()}|${job.company.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const selectedSeniority = profile ? listFromStored(profile.seniority) : [];
    const result = dedupedRows
      .filter((job) =>
        matchesSelectedSeniority(job.seniority, selectedSeniority),
      )
      .map((job) => {
        const stack = inferTechnologyStack(
          `${job.title} ${job.description}`,
          parse(job.stack),
        );
        const match = profile
          ? scoreJob(
              {
                title: job.title,
                description: job.description,
                stack,
                seniority: job.seniority,
                workMode: job.workMode,
                location: job.location,
                publishedAt: job.publishedAt,
              },
              {
                masteredSkills: listFromStored(profile.masteredSkills),
                desiredAreas: listFromStored(profile.desiredAreas),
                avoidTerms: listFromStored(profile.avoidTerms),
                seniority: selectedSeniority,
                preferredMode: allowedWorkModes(profile.preferredMode),
              },
            )
          : { score: 70, reasons: ["Complete seu perfil para personalizar"] };
        return { ...job, stack, score: match.score, reasons: match.reasons };
      });
    return NextResponse.json({
      jobs: result,
      total: totalCount,
      totalLinkedIn,
      totalOtherSources,
      sourcesCount,
      page,
      limit,
      hasMore: offset + limit < totalCount,
      mode: "database",
      personalized: Boolean(profile),
      period: period === "all" ? "all" : hours,
    });
  } catch (error) {
    return NextResponse.json(
      {
        jobs: [],
        mode: "unavailable",
        error: error instanceof Error ? error.message : "Banco indisponível",
      },
      { status: 503 },
    );
  }
}
