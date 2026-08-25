import { and, asc, desc, eq, gte, inArray, isNull, like, lte, notInArray, notLike, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db/index";
import { importRuns, jobImportRuns, jobs, jobSources, platformSettings, profiles, userJobStatus } from "../../../db/schema";
import { isTechnologyJob, profileAffinitySearchTerms, scoreJob } from "../../../lib/scoring";
import { inferTechnologyStack } from "../../../lib/technology-stack";
import { allowedWorkModes, listFromStored, normalizeCareerRules } from "../../../lib/profile-options";
import { computeVerdict, type VerdictEmoji } from "../../../lib/verdict";
import { JOB_AREAS } from "../../../lib/job-area";

export const dynamic = "force-dynamic";

// Uma única consulta evita repetir o mesmo filtro textual e a mesma ordenação
// para cada lote, que estourava o tempo do Worker em perfis amplos.
const MAX_AFFINITY_CANDIDATES = 500;
const LIST_DESCRIPTION_CHARS = 2_000;
const FILTER_DESCRIPTION_CHARS = 1_000;
// Toda vaga técnica começa com 5 pontos. Portanto, esse corte não precisa de
// uma varredura especial: a página normal já traz os scores necessários para
// esconder as vagas sem aderência no cliente.
const BASE_TECH_SCORE = 5;
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
const degradedMode = url.searchParams.get("degraded") === "1";
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

const user = degradedMode ? null : await getChatGPTUser();
const [profile, pipeline] = await Promise.all([
user
? getDb().select().from(profiles).where(eq(profiles.userId, user.userId)).limit(1).then((rows) => rows[0] ?? null)
: Promise.resolve(null),
user
? getDb().select().from(userJobStatus).where(eq(userJobStatus.userId, user.userId))
: Promise.resolve([]),
]);

const searchQuery = (url.searchParams.get("q") ?? "").trim().toLowerCase();
const minScoreParam = degradedMode ? null : url.searchParams.get("minScore");
const requestedMinScore = minScoreParam !== null && Number.isFinite(Number(minScoreParam))
? Math.max(0, Math.min(100, Number(minScoreParam)))
: 0;
const pipelineFilter = degradedMode ? "all" : url.searchParams.get("pipeline") ?? "all";
// A tela principal é uma fila de nova análise. Por padrão, não voltamos a
// apresentar vagas cujo e-mail já está em rascunho ou foi enviado; a pessoa
// pode pedir explicitamente para incluí-las de novo.
const reviewVisibility = url.searchParams.get("reviewVisibility") === "all" ? "all" : "pending";
const verdictFilter = degradedMode ? "all" : url.searchParams.get("verdict") ?? "all";
const sort = url.searchParams.get("sort") === "imported" ? "imported" : "score";
const sourceType = url.searchParams.get("sourceType") ?? "all";
const sourceId = (url.searchParams.get("sourceId") ?? "").trim();
const roleArea = (url.searchParams.get("area") ?? "").trim();
const ingestionChannel = (url.searchParams.get("channel") ?? "").trim();
const importRunId = (url.searchParams.get("importRun") ?? "").trim();
const ingestionMode = url.searchParams.get("ingestionMode") ?? "all";
const hasEmailParam = url.searchParams.get("hasEmail") ?? "all";
const parseDateParam = (name: string) => {
const value = url.searchParams.get(name);
if (!value) return null;
const parsed = new Date(value);
return Number.isFinite(parsed.getTime()) ? parsed : null;
};
const receivedFrom = parseDateParam("receivedFrom");
const receivedTo = parseDateParam("receivedTo");
const cutoff = hours ? new Date(Date.now() - hours * 36e5) : null;
// O período da Home representa quando a vaga entrou no Radar. A data de
// publicação é preservada para contexto, mas fontes que a omitem usam o
// horário da coleta como fallback e poderiam trazer vagas antigas de volta.
const receivedInPeriodCondition = cutoff
? and(eq(jobs.status, "active"), gte(jobs.firstSeenAt, cutoff))
: eq(jobs.status, "active");
const ingestionCondition = ingestionMode === "automatic"
? eq(jobs.ingestionMode, "automatic")
: ingestionMode === "manual"
? eq(jobs.ingestionMode, "manual")
: undefined;
const receivedCondition = and(
receivedFrom ? gte(jobs.firstSeenAt, receivedFrom) : undefined,
receivedTo ? lte(jobs.firstSeenAt, receivedTo) : undefined,
);
// "Sem e-mail" trata string vazia como ausência, não só NULL — o campo já
// foi salvo como "" em alguns fluxos antigos de captura.
const hasEmailCondition = hasEmailParam === "yes"
? and(sql`${jobs.contactEmail} is not null`, sql`${jobs.contactEmail} != ${""}`)
: hasEmailParam === "no"
? or(isNull(jobs.contactEmail), eq(jobs.contactEmail, ""))
: undefined;
// Base sem o próprio filtro de e-mail — usada só para contar quantas vagas
// ficariam de fora se "tem e-mail" fosse marcado, respeitando os demais
// filtros ativos (mesmo quando o checkbox está desmarcado).
const baseConditionWithoutEmailFilter = and(receivedInPeriodCondition, ingestionCondition, receivedCondition);
const baseCondition = and(baseConditionWithoutEmailFilter, hasEmailCondition);
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
const exactSourceCondition = sourceId === "unidentified"
? and(baseCondition, isNull(jobs.sourceId))
: sourceId
? and(baseCondition, eq(jobs.sourceId, sourceId))
: sourceCondition;
const roleAreaCondition = roleArea ? eq(jobs.roleArea, roleArea) : undefined;
const channelCondition = ingestionChannel ? eq(jobs.ingestionChannel, ingestionChannel as "extension" | "email" | "connector" | "file" | "api") : undefined;
const importRunCondition = importRunId
? sql`exists (select 1 from ${jobImportRuns} where ${jobImportRuns.jobId} = ${jobs.id} and ${jobImportRuns.runId} = ${importRunId})`
: undefined;

const selectedSeniority = profile ? listFromStored(profile.seniority) : [];
const masteredSkills = profile ? listFromStored(profile.masteredSkills) : [];
const desiredAreas = profile ? listFromStored(profile.desiredAreas) : [];
const preferredMode = profile ? allowedWorkModes(profile.preferredMode) : [];
const careerRules = normalizeCareerRules(profile?.careerRules);
const profileHasScoringSignals = Boolean(profile) && [
masteredSkills,
desiredAreas,
selectedSeniority,
preferredMode,
].some((values) => values.length > 0);
// Um filtro de aderência só é válido quando há perfil para calcular a aderência.
// Sem isso, mantemos as vagas visíveis com "sem score".
const minScore = profileHasScoringSignals ? requestedMinScore : 0;
const seniorityCondition = selectedSeniority.length
? or(isNull(jobs.seniority), ...selectedSeniority.map((level) => like(jobs.seniority, `%${level}%`)))
: undefined;
const searchPattern = `%${searchQuery}%`;
const searchCondition = searchQuery
? or(
eq(jobs.id, searchQuery),
like(jobs.externalId, searchPattern),
like(jobs.title, searchPattern),
like(jobs.company, searchPattern),
like(jobs.location, searchPattern),
like(jobs.seniority, searchPattern),
like(jobs.stack, searchPattern),
)
: undefined;
const pipelineIds = pipeline.map((item) => item.jobId);
const applicationIds = pipeline
  .filter((item) => item.applicationStatus === "generated" || item.applicationStatus === "sent" || item.applicationStatus === "responded")
  .map((item) => item.jobId);
const applicationVisibilityCondition = reviewVisibility === "pending" && applicationIds.length
  ? notInArray(jobs.id, applicationIds)
  : undefined;
const stageIds = pipeline.filter((item) => item.stage === pipelineFilter).map((item) => item.jobId);
const pipelineCondition = pipelineFilter === "all"
? undefined
: pipelineFilter === "unseen"
? pipelineIds.length ? notInArray(jobs.id, pipelineIds) : undefined
: stageIds.length ? inArray(jobs.id, stageIds) : eq(jobs.id, "__nenhuma_vaga__");
// O cálculo completo (materializar até MAX_AFFINITY_CANDIDATES, pontuar,
// ordenar e só então paginar) é necessário sempre que o resultado exibido
// depende do score — inclusive na ordenação padrão "Pontuação" (sort===
// "score"), não só quando há filtro de aderência/veredito ativo. Sem isso,
// a página vem paginada por data direto do banco e o score anexado deixa
// de refletir a ordem/paginação reais — sintoma: pontuação parece "não
// funcionar" sem filtro. O teto de MAX_AFFINITY_CANDIDATES continua sendo
// o limite de CPU no Worker gratuito: nunca materializamos mais que isso.
const requiresPostFiltering = minScore > BASE_TECH_SCORE || verdictFilter !== "all" || sort === "score";
// O score depende do perfil e não existe como coluna no banco. Antes de
// calculá-lo, reduzimos o universo com todos os sinais capazes de somar pontos.
// A condição é deliberadamente ampla: pode trazer falsos positivos, mas nunca
// deve esconder uma vaga que alcançaria o corte após o cálculo completo.
const affinityTerms = profileAffinitySearchTerms(masteredSkills, desiredAreas);
const affinityTextConditions = affinityTerms.flatMap((term) => {
  const pattern = `%${term}%`;
  return [
    like(jobs.title, pattern),
    like(sql<string>`substr(${jobs.description}, 1, ${FILTER_DESCRIPTION_CHARS})`, pattern),
    like(jobs.stack, pattern),
  ];
});
const recentAffinityCutoff = new Date(Date.now() - 24 * 36e5);
const affinityCandidateCondition = minScore > BASE_TECH_SCORE
? or(
  ...affinityTextConditions,
  ...selectedSeniority.map((level) => like(jobs.seniority, `%${level}%`)),
  ...preferredMode.map((mode) => like(jobs.workMode, `%${mode}%`)),
  gte(jobs.publishedAt, recentAffinityCutoff),
  gte(jobs.firstSeenAt, recentAffinityCutoff),
)
: undefined;
const condition = and(exactSourceCondition, roleAreaCondition, channelCondition, importRunCondition, seniorityCondition, searchCondition, pipelineCondition, applicationVisibilityCondition, affinityCandidateCondition);
// Contagem "sem e-mail" mostrada junto ao checkbox — sempre calculada com os
// mesmos filtros ativos (fonte, área, canal, importação, busca, pipeline),
// mas ignorando o próprio filtro de e-mail, para o número não desaparecer
// quando o checkbox está desmarcado nem ficar preso ao lado "com e-mail".
const noEmailCondition = or(isNull(jobs.contactEmail), eq(jobs.contactEmail, ""));
const exactSourceConditionNoEmailFilter = sourceId === "unidentified"
? and(baseConditionWithoutEmailFilter, isNull(jobs.sourceId))
: sourceId
? and(baseConditionWithoutEmailFilter, eq(jobs.sourceId, sourceId))
: sourceType === "linkedin"
? and(baseConditionWithoutEmailFilter, like(jobs.url, "%linkedin.com%"))
: sourceType === "apinfo"
? and(baseConditionWithoutEmailFilter, or(eq(jobs.sourceId, "apinfo-extension"), like(jobs.url, "%apinfo.com%")))
: sourceType === "other"
? and(baseConditionWithoutEmailFilter, notLike(jobs.url, "%linkedin.com%"), notLike(jobs.url, "%apinfo.com%"), sql`(${jobs.sourceId} is null or ${jobs.sourceId} != ${"apinfo-extension"})`)
: baseConditionWithoutEmailFilter;
const emailMissingCondition = and(
  exactSourceConditionNoEmailFilter,
  noEmailCondition,
roleAreaCondition,
channelCondition,
importRunCondition,
seniorityCondition,
  searchCondition,
  pipelineCondition,
  applicationVisibilityCondition,
);

const rowsQuery = getDb().select({
id: jobs.id,
externalId: jobs.externalId,
sourceId: jobs.sourceId,
company: jobs.company,
title: jobs.title,
seniority: jobs.seniority,
workMode: jobs.workMode,
location: jobs.location,
stack: jobs.stack,
publishedAt: sql<Date>`coalesce(${jobs.publishedAt}, ${jobs.firstSeenAt})`,
sourcePublishedAt: jobs.sourcePublishedAt,
firstSeenAt: jobs.firstSeenAt,
ingestionMode: jobs.ingestionMode,
ingestionChannel: jobs.ingestionChannel,
roleArea: jobs.roleArea,
sourceName: jobSources.name,
url: jobs.url,
applyUrl: jobs.applyUrl,
contactEmail: jobs.contactEmail,
contactSubject: jobs.contactSubject,
description: degradedMode
? sql<string>`''`
: requiresPostFiltering
? sql<string>`substr(${jobs.description}, 1, ${FILTER_DESCRIPTION_CHARS})`
: sql<string>`substr(${jobs.description}, 1, ${LIST_DESCRIPTION_CHARS})`,
}).from(jobs).leftJoin(jobSources, eq(jobs.sourceId, jobSources.id)).where(condition).orderBy(
sort === "imported" ? desc(jobs.firstSeenAt) : desc(jobs.publishedAt),
desc(jobs.createdAt),
);
const [rows, eligibleTotals, emailMissingTotals, sourceTotals, sourceOptionsRows, areaOptionsRows, channelOptionsRows, recentRuns] = await Promise.all([
requiresPostFiltering
? rowsQuery.limit(MAX_AFFINITY_CANDIDATES)
: rowsQuery.limit(limit).offset(offset),
getDb().select({ total: sql<number>`count(*)` }).from(jobs).where(condition),
getDb().select({ total: sql<number>`count(*)` }).from(jobs).where(emailMissingCondition),
getDb().select({
total: sql<number>`count(*)`,
linkedIn: sql<number>`sum(case when ${jobs.url} like ${"%linkedin.com%"} then 1 else 0 end)`,
apinfo: sql<number>`sum(case when ${jobs.sourceId} = ${"apinfo-extension"} or ${jobs.url} like ${"%apinfo.com%"} then 1 else 0 end)`,
sources: sql<number>`count(distinct ${jobs.sourceId})`,
}).from(jobs).where(and(baseCondition, applicationVisibilityCondition)),
getDb().select({ id: jobs.sourceId, label: jobSources.name, count: sql<number>`count(*)` })
  .from(jobs).leftJoin(jobSources, eq(jobs.sourceId, jobSources.id)).where(and(baseCondition, applicationVisibilityCondition))
  .groupBy(jobs.sourceId, jobSources.name).orderBy(asc(jobSources.name)),
getDb().select({ id: jobs.roleArea, count: sql<number>`count(*)` }).from(jobs).where(and(baseCondition, applicationVisibilityCondition)).groupBy(jobs.roleArea),
getDb().select({ id: jobs.ingestionChannel, count: sql<number>`count(*)` }).from(jobs).where(and(baseCondition, applicationVisibilityCondition)).groupBy(jobs.ingestionChannel),
getDb().select({ id: importRuns.id, source: importRuns.source, sourceId: importRuns.sourceId, channel: importRuns.channel, startedAt: importRuns.startedAt, received: importRuns.received, inserted: importRuns.inserted, updated: importRuns.updated, jobs: sql<number>`count(distinct ${jobImportRuns.jobId})` })
  .from(importRuns).innerJoin(jobImportRuns, eq(jobImportRuns.runId, importRuns.id))
  .groupBy(importRuns.id).orderBy(desc(importRuns.startedAt)).limit(30),
]);

const enriched = rows.map((job) => {
const stack = inferTechnologyStack(`${job.title} ${job.description}`, parse(job.stack));
const isTechJob = isTechnologyJob({ title: job.title, description: job.description, stack });
const match = !isTechJob
? { score: 0, reasons: ["Vaga fora do escopo de TI — sem pontuação"], scored: false }
: profileHasScoringSignals
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
desiredAreas,
avoidTerms: listFromStored(profile.avoidTerms),
seniority: selectedSeniority,
preferredMode,
},
)
: { score: 0, reasons: ["Complete seu perfil para calcular a aderência"], scored: false };
// Vagas fora de TI ficam visíveis para transparência, mas não participam de
// nenhum veredito de aderência — especialmente do filtro "Bate".
const verdict = isTechJob && verdictFilter !== "all" && masteredSkills.length
? computeVerdict(
{
title: job.title,
description: job.description,
stack,
seniority: job.seniority,
workMode: job.workMode,
location: job.location,
},
masteredSkills,
careerRules,
)
: null;
return { job, stack, score: match.score, reasons: match.reasons, scored: "scored" in match ? match.scored : true, verdict };
});

const filtered = requiresPostFiltering
? enriched.filter((item) =>
item.score >= minScore &&
(verdictFilter === "all" || item.verdict?.emoji === (verdictFilter as VerdictEmoji)),
)
: enriched;
if (sort !== "imported") filtered.sort((a, b) => b.score - a.score);
const totalCount = requiresPostFiltering
? filtered.length
: Number(eligibleTotals[0]?.total ?? 0);
const pageRows = requiresPostFiltering ? filtered.slice(offset, offset + limit) : filtered;
const applicationStatusByJobId = new Map(pipeline.map((item) => [item.jobId, item.applicationStatus]));
const result = pageRows.map(({ job, stack, score, reasons, scored }) => ({
...job,
description: "",
stack,
score,
reasons,
scored,
applicationStatus: applicationStatusByJobId.get(job.id) ?? null,
}));

const totalLinkedIn = Number(sourceTotals[0]?.linkedIn ?? 0);
const totalApinfo = Number(sourceTotals[0]?.apinfo ?? 0);
const baseTotal = Number(sourceTotals[0]?.total ?? 0);
return NextResponse.json({
jobs: result,
total: totalCount,
emailMissingCount: Number(emailMissingTotals[0]?.total ?? 0),
totalLinkedIn,
totalApinfo,
totalOtherSources: Math.max(0, baseTotal - totalLinkedIn - totalApinfo),
sourcesCount: Number(sourceTotals[0]?.sources ?? 0),
filterOptions: {
  sources: sourceOptionsRows.map(option => ({ id: option.id ?? "unidentified", label: option.label ?? "Sem fonte identificada", count: Number(option.count) || 0 })),
  areas: JOB_AREAS.map(option => ({ ...option, count: Number(areaOptionsRows.find(row => row.id === option.id)?.count) || 0 })),
  channels: [
    { id: "extension", label: "Extensão", count: Number(channelOptionsRows.find(row => row.id === "extension")?.count) || 0 },
    { id: "email", label: "E-mail", count: Number(channelOptionsRows.find(row => row.id === "email")?.count) || 0 },
    { id: "connector", label: "Coleta agendada", count: Number(channelOptionsRows.find(row => row.id === "connector")?.count) || 0 },
    { id: "file", label: "Arquivo CSV/JSON", count: Number(channelOptionsRows.find(row => row.id === "file")?.count) || 0 },
    { id: "api", label: "API", count: Number(channelOptionsRows.find(row => row.id === "api")?.count) || 0 },
  ],
  importRuns: recentRuns.map(run => ({ ...run, jobs: Number(run.jobs) || 0 })),
},
page,
limit,
hasMore: offset + limit < totalCount,
limited: requiresPostFiltering && Number(eligibleTotals[0]?.total ?? 0) > MAX_AFFINITY_CANDIDATES,
// Devolvido para a mensagem de aviso no cliente nunca ficar dessincronizada
// deste teto — antes era um número fixo no Dashboard.tsx que ficou
// desatualizado quando MAX_AFFINITY_CANDIDATES mudou de 2.500 para 500.
candidateLimit: MAX_AFFINITY_CANDIDATES,
mode: "database",
personalized: profileHasScoringSignals,
degraded: degradedMode,
period: period === "all" ? "all" : hours,
}, degradedMode ? { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=120" } } : undefined);
} catch (error) {
return NextResponse.json(
{ jobs: [], mode: "unavailable", error: error instanceof Error ? error.message : "Banco indisponível" },
{ status: 503 },
);
}
}
