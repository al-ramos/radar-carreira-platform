import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("a listagem pagina no D1 antes de enriquecer o fluxo normal", async () => {
  const route = await read("../app/api/jobs/route.ts");
  assert.match(route, /rowsQuery\.limit\(limit\)\.offset\(offset\)/);
  assert.match(route, /MAX_AFFINITY_CANDIDATES = 500/);
  assert.match(route, /rowsQuery\.limit\(MAX_AFFINITY_CANDIDATES\)/);
  assert.match(route, /profileAffinitySearchTerms/);
  assert.doesNotMatch(route, /while \(batch\.length/);
  assert.match(route, /description: ""/);
  assert.match(route, /or\(isNull\(jobs\.seniority\)/);
  assert.match(route, /LIST_DESCRIPTION_CHARS = 2_000/);
  assert.match(route, /FILTER_DESCRIPTION_CHARS = 1_000/);
  assert.match(route, /BASE_TECH_SCORE = 5/);
  assert.match(route, /minScore > BASE_TECH_SCORE/);
  // A ordenação padrão por Pontuação também exige o cálculo completo — sem
  // isso, a lista sem filtro pagina por data com o score anexado por cima,
  // sem refletir a ordem/paginação reais.
  assert.match(route, /requiresPostFiltering = .*sort === "score"/);
  assert.match(route, /substr\(\$\{jobs\.description\}/);
  assert.match(route, /const \[rows, eligibleTotals, emailMissingTotals, sourceTotals,/);
  assert.match(route, /verdictFilter !== "all" && masteredSkills\.length/);
  assert.match(route, /isTechnologyJob/);
  assert.match(route, /profileHasScoringSignals \? requestedMinScore : 0/);
  assert.match(route, /Vaga fora do escopo de TI — sem pontuação/);
  assert.match(route, /isTechJob && verdictFilter !== "all"/);
  const scoring = await read("../lib/scoring.ts");
  assert.match(scoring, /job\.publishedAt instanceof Date/);
});

test("a coleta agendada processa apenas uma fonte por chamada", async () => {
  const route = await read("../app/api/cron/collect/route.ts");
  assert.match(route, /const BATCH_SIZE = 1/);
  assert.match(route, /const LOOKUP_BATCH_SIZE = 100/);
  assert.match(route, /const WRITE_BATCH_SIZE = 50/);
  assert.match(route, /await getDb\(\)\.batch\(statements/);
  assert.doesNotMatch(route, /await getDb\(\)\.select\(\{ id: jobs\.id \}\)/);
});

test("o agendamento tolera indisponibilidade transitória sem sobrecarregar o Worker", async () => {
  const [workflow, connectors] = await Promise.all([
    read("../.github/workflows/collect.yml"),
    read("../lib/connectors.ts"),
  ]);
  assert.match(workflow, /start_offset/);
  assert.match(workflow, /offset="\$\{\{ inputs\.start_offset \|\| '0' \}\}"/);
  assert.match(workflow, /--retry 6 --retry-all-errors --retry-delay 15 --retry-max-time 120/);
  assert.match(workflow, /sleep 1/);
  assert.match(connectors, /MAX_JOB_DESCRIPTION_CHARS=12_000/);
  assert.match(connectors, /\.slice\(0,MAX_JOB_DESCRIPTION_CHARS\)/);
});

test("falha da API não exibe as quatro vagas demonstrativas", async () => {
  const dashboard = await read("../app/Dashboard.tsx");
  assert.match(dashboard, /useState<Job\[]>\(\[\]\)/);
  assert.match(dashboard, /setMode\("unavailable"\)/);
  assert.match(dashboard, /fetchJobsWithRetry/);
  assert.match(dashboard, /fetchWithTimeout/);
  assert.match(dashboard, /JOBS_FETCH_TIMEOUT_MS = 10_000/);
  assert.match(dashboard, /PROFILE_FETCH_TIMEOUT_MS = 8_000/);
  assert.match(dashboard, /searchParams\.set\("degraded", "1"\)/);
  assert.match(dashboard, /modo simplificado/);
  assert.match(dashboard, /A lista anterior pode estar desatualizada/);
  assert.match(dashboard, /Última atualização bem-sucedida/);
  assert.match(dashboard, /Atualizada às/);
  assert.match(dashboard, /staleRetryCountRef\.current < 3/);
  assert.match(dashboard, /sem score/);
  assert.doesNotMatch(dashboard, /score: j\.score \?\? 70/);
  assert.match(dashboard, /const visibleMinScore = simplifiedList \? 0 : loadedMinScore/);
  assert.match(dashboard, /setRequestedMinScore\(effectiveMinScore\)/);
  assert.match(dashboard, /setLoadedMinScore\(requestedMinScore\)/);
  assert.match(dashboard, /Atualizando pontuação/);
  assert.match(dashboard, /j\.score >= visibleMinScore/);
  assert.match(dashboard, /simplifiedRetryCountRef\.current >= 3/);
  assert.match(dashboard, /fetchJobsWithRetry\(`\/api\/jobs\?\$\{buildJobsParams\(page\)\}/);
  assert.match(dashboard, /if \(!profileReady \|\| profileLoadFailed\) return;/);
  assert.match(dashboard, /if \(!controller\.signal\.aborted\) setProfileReady\(true\)/);
  assert.match(dashboard, /const profileLoading = !profileReady \|\| mode === "loading"/);
  assert.match(dashboard, /Não foi possível carregar as vagas dentro do tempo esperado/);
  assert.match(dashboard, /Tentar novamente/);
  assert.match(dashboard, /Seu perfil está salvo\. A lista está temporariamente sem aderência/);
  assert.match(dashboard, /Pontuação/);
  assert.match(dashboard, /Escolher aderência mínima ao seu perfil/);
  assert.match(dashboard, /const orderedJobs = useMemo/);
  assert.doesNotMatch(dashboard, /\.catch\(\(\) => \{\s*setItems\(\[\]\)/);
});

test("a página autenticada não renderiza o dashboard pesado no Worker", async () => {
  const [page, shell] = await Promise.all([
    read("../app/page.tsx"),
    read("../app/DashboardShell.tsx"),
  ]);
  assert.match(page, /requireChatGPTUser/);
  assert.match(page, /<DashboardShell \/>/);
  assert.match(shell, /ssr: false/);
});

test("o Radar não calcula vereditos automaticamente na lista", async () => {
  const dashboard = await read("../app/Dashboard.tsx");
  assert.match(dashboard, /Vereditos não são gerados automaticamente no Radar/);
  assert.match(dashboard, /return new Map<string, VerdictResult>\(\);/);
  assert.match(dashboard, /verdictMap\.size > 0/);
});

test("contato existente vira ação de cópia e captura oferece fallback pela área de transferência", async () => {
  const [dashboard, route] = await Promise.all([
    read("../app/Dashboard.tsx"),
    read("../app/api/jobs/[id]/contact/route.ts"),
  ]);
  assert.match(dashboard, /if \(job\.contactEmail\)/);
  assert.match(dashboard, /disabled=\{contactCapturing\}/);
  assert.match(dashboard, /Copiar e-mail/);
  assert.match(dashboard, /navigator\.clipboard\.writeText\(selectedJob\.contactEmail\)/);
  assert.doesNotMatch(dashboard, /Recapturar e-mail/);
  assert.match(dashboard, /4_000/);
  assert.match(dashboard, /navigator\.clipboard\.readText\(\)/);
  assert.match(dashboard, /Colar e-mail/);
  assert.match(dashboard, /`apinfo - \$\{job\.externalId\} - \$\{job\.title\}`/);
  assert.match(route, /isNull\(jobs\.contactEmail\)/);
  assert.match(route, /status: 409/);
});
