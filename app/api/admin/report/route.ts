import { and, desc, eq, gte, like, notLike } from "drizzle-orm";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { jobs, jobSources, profiles, userJobStatus } from "../../../../db/schema";
import { allowedWorkModes, listFromStored } from "../../../../lib/profile-options";
import { matchesSelectedSeniority, scoreJob } from "../../../../lib/scoring";
import { inferTechnologyStack } from "../../../../lib/technology-stack";
import { computeVerdict, type VerdictEmoji } from "../../../../lib/verdict";

export const dynamic = "force-dynamic";

const csv = (value: unknown) =>
  `"${String(value ?? "").replaceAll('"', '""').replace(/[\r\n]+/g, " ")}"`;
const parseStack = (value: string) => {
  try {
    return JSON.parse(value) as string[];
  } catch {
    return [];
  }
};

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user)
    return Response.json({ error: "Autenticação necessária" }, { status: 401 });

  const db = getDb();
  const profile = (
    await db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, user.userId))
      .limit(1)
  )[0];
  const url = new URL(request.url);
  const period = url.searchParams.get("period") ?? "24";
  const sourceType = url.searchParams.get("sourceType") ?? "all";
  const searchQuery = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const minScore = Math.max(
    0,
    Math.min(100, Number(url.searchParams.get("minScore")) || 0),
  );
  const pipelineFilter = url.searchParams.get("pipeline") ?? "all";
  const verdictFilter = url.searchParams.get("verdict") ?? "all";
  const hours =
    period === "all" ? null : Math.max(1, Math.min(Number(period) || 24, 720));
  const cutoff = hours ? new Date(Date.now() - hours * 36e5) : null;
  const baseCondition = cutoff
    ? and(eq(jobs.status, "active"), gte(jobs.publishedAt, cutoff))
    : eq(jobs.status, "active");
  const condition =
    sourceType === "linkedin"
      ? and(baseCondition, like(jobs.url, "%linkedin.com%"))
      : sourceType === "other"
        ? and(baseCondition, notLike(jobs.url, "%linkedin.com%"))
        : baseCondition;

  const [rows, pipeline] = await Promise.all([
    db
      .select({ job: jobs, source: jobSources.name })
      .from(jobs)
      .leftJoin(jobSources, eq(jobs.sourceId, jobSources.id))
      .where(condition)
      .orderBy(desc(jobs.publishedAt)),
    db
      .select()
      .from(userJobStatus)
      .where(eq(userJobStatus.userId, user.userId)),
  ]);
  const byJob = new Map(pipeline.map((item) => [item.jobId, item]));
  const masteredSkills = profile ? listFromStored(profile.masteredSkills) : [];
  const selectedSeniority = profile ? listFromStored(profile.seniority) : [];

  const seen = new Set<string>();
  const filteredRows = rows.flatMap(({ job, source }) => {
    const deduplicationKey = `${job.title.toLowerCase()}|${job.company.toLowerCase()}`;
    if (seen.has(deduplicationKey)) return [];
    seen.add(deduplicationKey);
    if (!matchesSelectedSeniority(job.seniority, selectedSeniority)) return [];
    const stack = inferTechnologyStack(
      `${job.title} ${job.description}`,
      parseStack(job.stack),
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
            masteredSkills,
            desiredAreas: listFromStored(profile.desiredAreas),
            avoidTerms: listFromStored(profile.avoidTerms),
            seniority: selectedSeniority,
            preferredMode: allowedWorkModes(profile.preferredMode),
          },
        )
      : { score: 70 };
    const state = byJob.get(job.id);
    const searchable = `${job.title} ${job.company} ${job.location ?? ""} ${job.seniority ?? ""} ${stack.join(" ")}`.toLowerCase();
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
    const matchesPipeline =
      pipelineFilter === "all" ||
      (pipelineFilter === "unseen"
        ? !state
        : state?.stage === pipelineFilter);
    const matchesVerdict =
      verdictFilter === "all" || verdict?.emoji === (verdictFilter as VerdictEmoji);

    if (
      match.score < minScore ||
      (searchQuery && !searchable.includes(searchQuery)) ||
      !matchesPipeline ||
      !matchesVerdict
    )
      return [];
    return [{ job, source, state, stack, score: match.score, verdict }];
  });

  const header = [
    "Data da coleta",
    "Data de publicação",
    "Fonte",
    "Cargo",
    "Empresa",
    "Localização",
    "Modalidade",
    "Senioridade",
    "Aderência",
    "Veredito",
    "Tecnologias",
    "Descrição detalhada",
    "Link",
    "Status",
    "Etapa do pipeline",
    "Observações",
  ];
  const lines = filteredRows.map(({ job, source, state, stack, score, verdict }) =>
    [
      job.firstSeenAt.toISOString(),
      job.publishedAt?.toISOString() ?? "",
      source ?? "Importação manual",
      job.title,
      job.company,
      job.location,
      job.workMode,
      job.seniority,
      `${score}%`,
      verdict ? `${verdict.emoji} ${verdict.label}` : "",
      stack.join(", "),
      job.description,
      job.url,
      job.status,
      state?.stage ?? "new",
      state?.note ?? "",
    ]
      .map(csv)
      .join(";"),
  );
  const body = `\uFEFF${header.map(csv).join(";")}\r\n${lines.join("\r\n")}`;
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="radar-vagas-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
