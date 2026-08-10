import { and, desc, eq, gte, inArray, isNull, like, notInArray, notLike, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db/index";
import { jobs, platformSettings, profiles, userJobStatus } from "../../../db/schema";
import { scoreJob } from "../../../lib/scoring";
import { inferTechnologyStack } from "../../../lib/technology-stack";
import { allowedWorkModes, listFromStored } from "../../../lib/profile-options";
import { computeVerdict, type VerdictEmoji } from "../../../lib/verdict";

export const dynamic = "force-dynamic";

const MAX_FILTER_CANDIDATES = 400;
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
    const configuredPeriod = (
      await getDb()
        .select({ defaultPeriod: platformSettings.defaultPeriod })
        .from(platformSettings)
        .where(eq(platformSettings.id, "global"))
        .limit(1)
    )[0]?.defaultPeriod ?? "24";
    const period = new Set(["24", "72", "168", "all"]).has(requestedPeriod ?? "")
      ? requestedPeriod!
      : configuredPeriod;
    const hours = period === "all" ? null : Math.max(1, Math.min(Number(period) || 24, 24 * 30));

    const user = await getChatGPTUser();
    const [profile, pipeline] = await Promise.all([
      user
        ? getDb().select().from(profiles).where(eq(profiles.userId, user.userId)).limit(1).then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
      user
        ? getDb().select().from(userJobStatus).where(eq(userJobStatus.userId, user.userId))
        : Promise.resolve([]),
    ]);

    const searchQuery = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const minScoreParam = url.searchParams.get("minScore");
    const minScore = minScoreParam !== null && Number.isFinite(Number(minScoreParam))
      ? Math.max(0, Math.min(100, Number(minScoreParam)))
      : 0;
    const pipelineFilter = url.searchParams.get("pipeline") ?? "all";
    const verdictFilter = url.searchParams.get("verdict") ?? "all";
    const sourceType = url.searchParams.get("sourceType") ?? "all";
    const cutoff = hours ? new Date(Date.now() - hours * 36e5) : null;
    const baseCondition = cutoff
      ? and(eq(jobs.status, "active"), gte(jobs.publishedAt, cutoff))
      : eq(jobs.status, "active");
    const linkedInCondition = and(baseCondition, like(jobs.url, "%linkedin.com%"));
    const apinfoCondition = and(
      baseCondition,
      or(eq(jobs.sourceId, "apinfo-extension"), like(jobs.url, "%apinfo.com%")),
    );
    const otherCondition = and(
      baseCondition,
      notLike(jobs.url, "%linkedin.com%"),
      notLike(jobs.url, "%apinfo.com%"),
      sql`(${jobs.sourceId} is null or ${jobs.sourceId} != ${"apinfo-extension"})`,
    );
    const sourceCondition = sourceType === "linkedin"
      ? linkedInCondition
      : sourceType === "apinfo"
        ? apinfoCondition
        : sourceType === "other"
          ? otherCondition
          : baseCondition;

    const selectedSeniority = profile ? listFromStored(profile.seniority) : [];
    const seniorityCondition = selectedSeniority.length
      ? or(isNull(jobs.seniority), ...selectedSeniority.map((level) => like(jobs.seniority, `%${level}%`)))
      : undefined;
    const searchPattern = `%${searchQuery}%`;
    const searchCondition = searchQuery
      ? or(
          like(jobs.title, searchPattern),
          like(jobs.company, searchPattern),
          like(jobs.location, searchPattern),
          like(jobs.seniority, searchPattern),
          like(jobs.stack, searchPattern),
        )
      : undefined;
    const pipelineIds = pipeline.map((item) => item.jobId);
    const stageIds = pipeline.filter((item) => item.stage === pipelineFilter).map((item) => item.jobId);
    const pipelineCondition = pipelineFilter === "all"
      ? undefined
      : pipelineFilter === "unseen"
        ? pipelineIds.length ? notInArray(jobs.id, pipelineIds) : undefined
        : stageIds.length ? inArray(jobs.id, stageIds) : eq(jobs.id, "__nenhuma_vaga__");
    const condition = and(sourceCondition, seniorityCondition, searchCondition, pipelineCondition);
    const requiresPostFiltering = minScore > 0 || verdictFilter !== "all";

    const rowsQuery = getDb().select().from(jobs).where(condition).orderBy(desc(jobs.publishedAt), desc(jobs.createdAt));
    const [rows, eligibleTotals, linkedInTotals, apinfoTotals, baseTotals, sourcesResult] = await Promise.all([
      requiresPostFiltering
        ? rowsQuery.limit(MAX_FILTER_CANDIDATES)
        : rowsQuery.limit(limit).offset(offset),
      getDb().select({ total: sql<number>`count(*)` }).from(jobs).where(condition),
      getDb().select({ total: sql<number>`count(*)` }).from(jobs).where(linkedInCondition),
      getDb().select({ total: sql<number>`count(*)` }).from(jobs).where(apinfoCondition),
      getDb().select({ total: sql<number>`count(*)` }).from(jobs).where(baseCondition),
      getDb().select({ count: sql<number>`count(distinct ${jobs.sourceId})` }).from(jobs).where(baseCondition),
    ]);

    const masteredSkills = profile ? listFromStored(profile.masteredSkills) : [];
    const enriched = rows.map((job) => {
      const stack = inferTechnologyStack(`${job.title} ${job.description}`, parse(job.stack));
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
              masteredSkills,
              desiredAreas: listFromStored(profile.desiredAreas),
              avoidTerms: listFromStored(profile.avoidTerms),
              seniority: selectedSeniority,
              preferredMode: allowedWorkModes(profile.preferredMode),
            },
          )
        : { score: 70, reasons: ["Complete seu perfil para personalizar"] };
      const verdict = masteredSkills.length
        ? computeVerdict(
            {
              title: job.title,
              description: job.description,
              stack,
              seniority: job.seniority,
              workMode: job.workMode,
            },
            masteredSkills,
          )
        : null;
      return { job, stack, score: match.score, reasons: match.reasons, verdict };
    });

    const filtered = requiresPostFiltering
      ? enriched.filter((item) =>
          item.score >= minScore &&
          (verdictFilter === "all" || item.verdict?.emoji === (verdictFilter as VerdictEmoji)),
        )
      : enriched;
    filtered.sort((a, b) => b.score - a.score);
    const totalCount = requiresPostFiltering
      ? filtered.length
      : Number(eligibleTotals[0]?.total ?? 0);
    const pageRows = requiresPostFiltering ? filtered.slice(offset, offset + limit) : filtered;
    const result = pageRows.map(({ job, stack, score, reasons }) => ({
      ...job,
      description: "",
      stack,
      score,
      reasons,
    }));

    const totalLinkedIn = Number(linkedInTotals[0]?.total ?? 0);
    const totalApinfo = Number(apinfoTotals[0]?.total ?? 0);
    const baseTotal = Number(baseTotals[0]?.total ?? 0);
    return NextResponse.json({
      jobs: result,
      total: totalCount,
      totalLinkedIn,
      totalApinfo,
      totalOtherSources: Math.max(0, baseTotal - totalLinkedIn - totalApinfo),
      sourcesCount: Number(sourcesResult[0]?.count ?? 0),
      page,
      limit,
      hasMore: offset + limit < totalCount,
      limited: requiresPostFiltering && Number(eligibleTotals[0]?.total ?? 0) > MAX_FILTER_CANDIDATES,
      mode: "database",
      personalized: Boolean(profile),
      period: period === "all" ? "all" : hours,
    });
  } catch (error) {
    return NextResponse.json(
      { jobs: [], mode: "unavailable", error: error instanceof Error ? error.message : "Banco indisponível" },
      { status: 503 },
    );
  }
}
