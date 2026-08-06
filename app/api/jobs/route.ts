import { and, count, desc, eq, gte } from "drizzle-orm";
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
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 250);
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
    const condition = cutoff
      ? and(eq(jobs.status, "active"), gte(jobs.publishedAt, cutoff))
      : eq(jobs.status, "active");
    const [rows, totals] = await Promise.all([
      getDb()
        .select()
        .from(jobs)
        .where(condition)
        .orderBy(desc(jobs.publishedAt))
        .limit(limit),
      getDb().select({ total: count() }).from(jobs).where(condition),
    ]);
    const selectedSeniority = profile ? listFromStored(profile.seniority) : [];
    const result = rows
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
      total: Number(totals[0]?.total ?? 0),
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
