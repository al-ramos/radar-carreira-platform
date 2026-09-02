import { and, asc, desc, eq, gte, inArray, isNull, like, lte, notInArray, notLike, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db/index";
import { importRuns, jobImportRuns, jobs, jobSources, platformSettings, profiles, triageHistory, userJobAnalyses, userJobStatus } from "../../../db/schema";
import { isTechnologyJob, profileAffinitySearchTerms, scoreJob } from "../../../lib/scoring";
import { inferTechnologyStack } from "../../../lib/technology-stack";
import { allowedWorkModes, listFromStored, normalizeCareerRules } from "../../../lib/profile-options";
import { computeVerdict, type VerdictEmoji } from "../../../lib/verdict";
import { JOB_AREAS } from "../../../lib/job-area";
import { d1QuotaResponse } from "../../../lib/d1-quota";

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
const startedAt = performance.now();
try {
const url = new URL(request.url);
const degradedMode = url.searchParams.get("degraded") === "1";
// "none" mantém o caminho crítico da lista pequeno. A tela pede as opções
// de filtros em seguida com "only", sem bloquear a primeira renderização.
const metadataMode = url.searchParams.get("meta") === "only"
  ? "only"
  : url.searchParams.get("meta") === "none" ? "none" : "full";
const requestedJobId = (url.searchParams.get("jobId") ?? "").trim();
const requestedExternalCode = (url.searchParams.get("code") ?? "").trim();
// Abrir uma vaga pelo histórico não precisa recalcular os totais, fontes e
// opções da Home inteira. Essas agregações podem ultrapassar o limite do
// Worker justamente quando a pessoa só quer consultar uma única vaga antiga.
if (requestedJobId || requestedExternalCode) {
  const user = degradedMode ? null : await getChatGPTUser();
  const directJob = await getDb().select({
    id: jobs.id,
    externalId: jobs.externalId,
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
    sourceName: sql<string>`coalesce(${jobSources.name}, ${"Fonte importada"})`,
    url: jobs.url,
    applyUrl: jobs.applyUrl,
    contactEmail: jobs.contactEmail,
    contactSubject: jobs.contactSubject,
    triageHistoryId: sql<string | null>`(
      select ${triageHistory.id} from ${triageHistory}
      where ${triageHistory.userId} = ${user?.userId ?? "__anonymous__"}
        and ${triageHistory.jobId} = ${jobs.id}
      order by ${triageHistory.createdAt} desc
      limit 1
    )`,
  }).from(jobs)
    .leftJoin(jobSources, eq(jobs.sourceId, jobSources.id))
    .where(requestedJobId ? eq(jobs.id, requestedJobId) : eq(jobs.externalId, requestedExternalCode))
    .orderBy(desc(jobs.firstSeenAt), desc(jobs.createdAt))
    .limit(1)
    .then((rows) => rows[0] ?? null);
  if (!directJob) return NextResponse.json({ jobs: [], total: 0, mode: "database", degraded: degradedMode });
  const stack = inferTechnologyStack(`${directJob.title}`, parse(directJob.stack));
  return NextResponse.json({
    jobs: [{ ...directJob, description: "", stack, score: 0, reasons: ["Vaga aberta pelo histórico"], scored: false, triaged: Boolean(directJob.triageHistoryId), applicationStatus: null }],
    total: 1,
    emailMissingCount: directJob.contactEmail ? 0 : 1,
    totalLinkedIn: 0,
    totalApinfo: 0,
    totalOtherSources: 0,
    sourcesCount: 0,
    filterOptions: { sources: [], areas: [], channels: [], importRuns: [] },
    page: 1,
    limit: 1,
    hasMore: false,
    limited: false,
    candidateLimit: MAX_AFFINITY_CANDIDATES,
    mode: "database",
    personalized: false,
    degraded: degradedMode,
    period: "all",
  }, { headers: { "Cache-Control": "private, no-store", "X-Radar-Jobs-Mode": "direct" } });
}
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
const priorityFilter = degradedMode ? "all" : url.searchParams.get("priority") ?? "all";
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
  .filter((item) => item.applicationStatus === "opened" || item.applicationStatus === "generated" || item.applicationStatus === "sent" || item.applicationStatus === "responded")
  .map((item) => item.jobId);
// A exclusão padrão organiza a fila, mas não pode esconder uma vaga quando a
// pessoa a procura deliberadamente por código, título, empresa etc.
const applicationVisibilityCondition = reviewVisibility === "pending" && !searchQuery && applicationIds.length
  ? notInArray(jobs.id, applicationIds)
  : undefined;
const stageIds = pipeline.filter((item) => item.stage === pipelineFilter).map((item) => item.jobId);
const pipelineCondition = pipelineFilter === "all"
? undefined
: pipelineFilter === "unseen"
? pipelineIds.length ? notInArray(jobs.id, pipelineIds) : undefined
: stageIds.length ? inArray(jobs.id, stageIds) : eq(jobs.id, "__nenhuma_vaga__");
const priorityIds = pipeline.filter((item) => item.priority === priorityFilter).map((item) => item.jobId);
const priorityCondition = priorityFilter === "all"
? undefined
: priorityIds.length ? inArray(jobs.id, priorityIds) : eq(jobs.id, "__nenhuma_vaga__");
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
// O histórico conserva vagas depois que elas saem da fila ativa. Este atalho
// abre um registro que a pessoa já selecionou, portanto precisa encontrá-lo
// inclusive quando estiver arquivado; a listagem normal continua limitada às
// vagas ativas pelo receivedInPeriodCondition.
const condition = requestedJobId
? eq(jobs.id, requestedJobId)
: and(exactSourceCondition, roleAreaCondition, channelCondition, importRunCondition, seniorityCondition, searchCondition, pipelineCondition, priorityCondition, applicationVisibilityCondition, affinityCandidateCondition);
// Importações antigas podem referenciar um UUID que não sobreviveu na tabela
// de fontes. Nunca exponha esse identificador interno no Radar: recupera o
// nome registrado na importação e, para os conectores conhecidos, usa a URL.
const sourceLabel = sql<string | null>`coalesce(
  ${jobSources.name},
  (select ${importRuns.source} from ${jobImportRuns}
    inner join ${importRuns} on ${jobImportRuns.runId} = ${importRuns.id}
    where ${jobImportRuns.jobId} = ${jobs.id}
    order by ${jobImportRuns.receivedAt} desc limit 1),
  case
    when ${jobs.url} like ${"%linkedin.com%"} then ${"LinkedIn"}
    when ${jobs.url} like ${"%apinfo.com%"} then ${"APInfo"}
    else ${"Fonte importada"}
  end
)`;
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

const filterOptionsQueries = () => Promise.all([
  getDb().select({ id: jobs.sourceId, label: sourceLabel, count: sql<number>`count(*)` })
    .from(jobs).leftJoin(jobSources, eq(jobs.sourceId, jobSources.id)).where(and(baseCondition, applicationVisibilityCondition))
    .groupBy(jobs.sourceId, sourceLabel).orderBy(asc(sourceLabel)),
  getDb().select({ id: jobs.roleArea, count: sql<number>`count(*)` }).from(jobs).where(and(baseCondition, applicationVisibilityCondition)).groupBy(jobs.roleArea),
  getDb().select({ id: jobs.ingestionChannel, count: sql<number>`count(*)` }).from(jobs).where(and(baseCondition, applicationVisibilityCondition)).groupBy(jobs.ingestionChannel),
  // `received` já é o total persistido do lote. Agregar todos os vínculos de
  // job_import_runs antes do LIMIT lia ~57 mil linhas por abertura da Home.
  getDb().select({ id: importRuns.id, source: importRuns.source, sourceId: importRuns.sourceId, channel: importRuns.channel, startedAt: importRuns.startedAt, received: importRuns.received, inserted: importRuns.inserted, updated: importRuns.updated, jobs: importRuns.received })
    .from(importRuns).orderBy(desc(importRuns.startedAt)).limit(30),
]);
const serializeFilterOptions = (sourceOptionsRows: Awaited<ReturnType<typeof filterOptionsQueries>>[0], areaOptionsRows: Awaited<ReturnType<typeof filterOptionsQueries>>[1], channelOptionsRows: Awaited<ReturnType<typeof filterOptionsQueries>>[2], recentRuns: Awaited<ReturnType<typeof filterOptionsQueries>>[3]) => ({
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
});

if (metadataMode === "only") {
  const filterOptions = serializeFilterOptions(...await filterOptionsQueries());
  const durationMs = Math.round(performance.now() - startedAt);
  console.log(JSON.stringify({ event: "jobs_filter_options", durationMs, period }));
  return NextResponse.json({ filterOptions, period: period === "all" ? "all" : hours }, {
    headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=120", "Server-Timing": `radar-job-options;dur=${durationMs}`, "X-Radar-Jobs-Mode": "metadata" },
  });
}

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
sourceName: sourceLabel,
url: jobs.url,
applyUrl: jobs.applyUrl,
contactEmail: jobs.contactEmail,
contactSubject: jobs.contactSubject,
triageVerdict: userJobAnalyses.verdict,
analysisScore: userJobAnalyses.score,
analysisProfileVersion: userJobAnalyses.profileVersion,
analysisUpdatedAt: userJobAnalyses.updatedAt,
jobUpdatedAt: jobs.updatedAt,
// Um registro em user_job_analyses pode vir de cálculos legados de afinidade.
// A nota somente é apresentada quando a vaga passou por uma triagem auditável.
triageHistoryId: sql<string | null>`(
  select ${triageHistory.id} from ${triageHistory}
  where ${triageHistory.userId} = ${user?.userId ?? "__anonymous__"}
    and ${triageHistory.jobId} = ${jobs.id}
  order by ${triageHistory.createdAt} desc
  limit 1
)`,
description: degradedMode
? sql<string>`''`
: requiresPostFiltering
? sql<string>`substr(${jobs.description}, 1, ${FILTER_DESCRIPTION_CHARS})`
: sql<string>`substr(${jobs.description}, 1, ${LIST_DESCRIPTION_CHARS})`,
}).from(jobs)
  .leftJoin(jobSources, eq(jobs.sourceId, jobSources.id))
  .leftJoin(userJobAnalyses, and(eq(userJobAnalyses.userId, user?.userId ?? "__anonymous__"), eq(userJobAnalyses.jobId, jobs.id)))
  .where(condition).orderBy(
sort === "imported" ? desc(jobs.firstSeenAt) : desc(jobs.publishedAt),
desc(jobs.createdAt),
);
const summaryCondition = and(baseCondition, applicationVisibilityCondition);
// Uma única passagem substitui três COUNTs independentes sobre toda a tabela.
// Com ~5,7 mil vagas e centenas de paginações, as três varreduras anteriores
// eram suficientes para consumir sozinhas a cota diária de 5 milhões de rows.
const summaryQuery = getDb().select({
  eligible: sql<number>`sum(case when ${condition} then 1 else 0 end)`,
  emailMissing: sql<number>`sum(case when ${emailMissingCondition} then 1 else 0 end)`,
  total: sql<number>`sum(case when ${summaryCondition} then 1 else 0 end)`,
  linkedIn: sql<number>`sum(case when ${summaryCondition} and ${jobs.url} like ${"%linkedin.com%"} then 1 else 0 end)`,
  apinfo: sql<number>`sum(case when ${summaryCondition} and (${jobs.sourceId} = ${"apinfo-extension"} or ${jobs.url} like ${"%apinfo.com%"}) then 1 else 0 end)`,
  sources: sql<number>`count(distinct case when ${summaryCondition} then ${jobs.sourceId} end)`,
}).from(jobs);
const [rows, summaryTotals, ...metadataRows] = await Promise.all([
requiresPostFiltering
? rowsQuery.limit(MAX_AFFINITY_CANDIDATES)
: rowsQuery.limit(limit).offset(offset),
summaryQuery,
...(metadataMode === "full" ? filterOptionsQueries() : []),
]);

const filterOptions = metadataMode === "full"
  ? serializeFilterOptions(...metadataRows as Awaited<ReturnType<typeof filterOptionsQueries>>)
  : undefined;

const enriched = rows.map((job) => {
const hasCurrentPersistedScore = Boolean(
  profile &&
  job.analysisScore !== null &&
  job.analysisProfileVersion?.getTime() === profile.updatedAt.getTime() &&
  job.analysisUpdatedAt?.getTime() >= job.jobUpdatedAt.getTime(),
);
const stack = hasCurrentPersistedScore
  ? parse(job.stack)
  : inferTechnologyStack(`${job.title} ${job.description}`, parse(job.stack));
const isTechJob = isTechnologyJob({ title: job.title, description: job.description, stack });
const match = !isTechJob
? { score: 0, reasons: ["Vaga fora do escopo de TI — sem pontuação"], scored: false }
: hasCurrentPersistedScore
? { score: Number(job.analysisScore), reasons: ["Pontuação reaproveitada da triagem atual"], scored: true }
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
: Number(summaryTotals[0]?.eligible ?? 0);
const pageRows = requiresPostFiltering ? filtered.slice(offset, offset + limit) : filtered;
const applicationStatusByJobId = new Map(pipeline.map((item) => [item.jobId, item.applicationStatus]));
const priorityByJobId = new Map(pipeline.map((item) => [item.jobId, item.priority]));
const result = pageRows.map(({ job, stack, score, reasons, scored }) => ({
...job,
description: "",
stack,
score,
reasons,
scored,
// O cálculo de afinidade ajuda a ordenar a fila, mas não é um resultado de
// triagem. A interface só pode exibir uma nota após uma triagem auditável.
triaged: Boolean(job.triageHistoryId),
applicationStatus: applicationStatusByJobId.get(job.id) ?? null,
priority: priorityByJobId.get(job.id) ?? null,
}));

const totalLinkedIn = Number(summaryTotals[0]?.linkedIn ?? 0);
const totalApinfo = Number(summaryTotals[0]?.apinfo ?? 0);
const baseTotal = Number(summaryTotals[0]?.total ?? 0);
const headers = new Headers(degradedMode ? { "Cache-Control": "private, max-age=30, stale-while-revalidate=120" } : undefined);
headers.set("Server-Timing", `radar-jobs;dur=${Math.round(performance.now() - startedAt)}`);
headers.set("X-Radar-Jobs-Mode", degradedMode ? "degraded" : "full");
console.log(JSON.stringify({ event: "jobs_list", mode: degradedMode ? "degraded" : "full", durationMs: Math.round(performance.now() - startedAt), period }));
return NextResponse.json({
jobs: result,
total: totalCount,
emailMissingCount: Number(summaryTotals[0]?.emailMissing ?? 0),
totalLinkedIn,
totalApinfo,
totalOtherSources: Math.max(0, baseTotal - totalLinkedIn - totalApinfo),
sourcesCount: Number(summaryTotals[0]?.sources ?? 0),
filterOptions,
page,
limit,
hasMore: offset + limit < totalCount,
limited: requiresPostFiltering && Number(summaryTotals[0]?.eligible ?? 0) > MAX_AFFINITY_CANDIDATES,
// Devolvido para a mensagem de aviso no cliente nunca ficar dessincronizada
// deste teto — antes era um número fixo no Dashboard.tsx que ficou
// desatualizado quando MAX_AFFINITY_CANDIDATES mudou de 2.500 para 500.
candidateLimit: MAX_AFFINITY_CANDIDATES,
mode: "database",
personalized: profileHasScoringSignals,
degraded: degradedMode,
period: period === "all" ? "all" : hours,
}, { headers });
} catch (error) {
console.error(JSON.stringify({ event: "jobs_list_failed", durationMs: Math.round(performance.now() - startedAt), error: error instanceof Error ? error.message : "Banco indisponível" }));
const quota = d1QuotaResponse(error);
if (quota) return quota;
return NextResponse.json(
{ jobs: [], mode: "unavailable", error: error instanceof Error ? error.message : "Banco indisponível" },
{ status: 503, headers: { "Server-Timing": `radar-jobs;dur=${Math.round(performance.now() - startedAt)}`, "X-Radar-Jobs-Mode": "unavailable" } },
);
}
}
