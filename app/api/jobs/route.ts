import { and, eq, gte, like, notLike, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db/index";
import { jobs, platformSettings, profiles, userJobStatus } from "../../../db/schema";
import { matchesSelectedSeniority, scoreJob } from "../../../lib/scoring";
import { inferTechnologyStack } from "../../../lib/technology-stack";
import { allowedWorkModes, listFromStored } from "../../../lib/profile-options";
import { computeVerdict, type VerdictEmoji } from "../../../lib/verdict";

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

    // Filtros que antes eram aplicados só no client, em cima da página já
    // carregada — o que fazia o total (e a contagem de páginas) não bater
    // com o que realmente restava depois de filtrar por aderência, busca,
    // etapa do pipeline ou veredito. Agora entram na mesma passada do
    // servidor, antes do LIMIT/OFFSET, para que 'total' seja sempre o
    // total real pós-filtro.
    const searchQuery = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const minScoreParam = url.searchParams.get("minScore");
    const minScore =
      minScoreParam !== null && Number.isFinite(Number(minScoreParam))
        ? Math.max(0, Math.min(100, Number(minScoreParam)))
        : 0;
    const pipelineFilter = url.searchParams.get("pipeline") ?? "all";
    const verdictFilter = url.searchParams.get("verdict") ?? "all";

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
    // "Do APinfo": sourceId setado pela extensão na importação, com
    // fallback para a URL (o link sintético gerado por page-collector.js
    // sempre aponta para apinfo.com) — cobre qualquer vaga histórica cujo
    // sourceId não tenha sido preenchido.
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
    // sourceType: filtro de fonte aplicado ANTES do LIMIT/OFFSET
    const sourceType = url.searchParams.get("sourceType") ?? "all";
    const condition =
      sourceType === "linkedin"
        ? linkedInCondition
        : sourceType === "apinfo"
          ? apinfoCondition
          : sourceType === "other"
            ? otherCondition
            : baseCondition;
    // Sem LIMIT/OFFSET aqui: score, veredito e etapa do pipeline só existem
    // depois de calculados em JS, então o universo do período+fonte inteiro
    // precisa ser processado antes de sabermos quais linhas sobrevivem aos
    // filtros — e só então paginar sobre o resultado já filtrado.
    const [rows, linkedInTotals, apinfoTotals, baseTotals, sourcesResult, pipeline] = await Promise.all([
      getDb().select().from(jobs).where(condition),
      getDb().select({ total: sql<number>`count(*)` }).from(jobs).where(linkedInCondition),
      getDb().select({ total: sql<number>`count(*)` }).from(jobs).where(apinfoCondition),
      getDb().select({ total: sql<number>`count(*)` }).from(jobs).where(baseCondition),
      getDb()
        .select({ count: sql<number>`count(distinct ${jobs.sourceId})` })
        .from(jobs)
        .where(baseCondition),
      user
        ? getDb().select().from(userJobStatus).where(eq(userJobStatus.userId, user.userId))
        : Promise.resolve([]),
    ]);
    const totalLinkedIn = Number(linkedInTotals[0]?.total ?? 0);
    const totalApinfo = Number(apinfoTotals[0]?.total ?? 0);
    const baseTotal = Number(baseTotals[0]?.total ?? 0);
    const totalOtherSources = Math.max(0, baseTotal - totalLinkedIn - totalApinfo);
    const sourcesCount = Number(sourcesResult[0]?.count ?? 0);
    const byJob = new Map(pipeline.map((item) => [item.jobId, item]));

    const selectedSeniority = profile ? listFromStored(profile.seniority) : [];
    const masteredSkills = profile ? listFromStored(profile.masteredSkills) : [];
    // A unicidade já é garantida pelo fingerprint na gravação. Agrupar também
    // por cargo+empresa ocultava vagas distintas importadas da mesma empresa e
    // fazia o total da tela divergir do total das fontes.
    const enriched = rows
      .filter((job) => matchesSelectedSeniority(job.seniority, selectedSeniority))
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
        const state = byJob.get(job.id);
        return { job, stack, score: match.score, reasons: match.reasons, verdict, state };
      });

    const searchable = (item: (typeof enriched)[number]) =>
      `${item.job.title} ${item.job.company} ${item.job.location ?? ""} ${item.job.seniority ?? ""} ${item.stack.join(" ")}`.toLowerCase();
    const filtered = enriched.filter((item) => {
      const matchesScore = item.score >= minScore;
      const matchesQuery = !searchQuery || searchable(item).includes(searchQuery);
      const matchesPipeline =
        pipelineFilter === "all" ||
        (pipelineFilter === "unseen" ? !item.state : item.state?.stage === pipelineFilter);
      const matchesVerdict =
        verdictFilter === "all" || item.verdict?.emoji === (verdictFilter as VerdictEmoji);
      return matchesScore && matchesQuery && matchesPipeline && matchesVerdict;
    });
    const totalCount = filtered.length;
    // Mesmo critério de ordenação já usado no client (maior aderência primeiro),
    // aplicado antes de paginar para que a ordem seja estável entre páginas.
    filtered.sort((a, b) => b.score - a.score);
    const page_ = filtered.slice(offset, offset + limit);
    const result = page_.map(({ job, stack, score, reasons }) => ({
      ...job,
      stack,
      score,
      reasons,
    }));

    return NextResponse.json({
      jobs: result,
      total: totalCount,
      totalLinkedIn,
      totalApinfo,
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
