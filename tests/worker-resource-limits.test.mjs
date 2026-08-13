import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("a listagem pagina no D1 antes de enriquecer o fluxo normal", async () => {
  const route = await read("../app/api/jobs/route.ts");
  assert.match(route, /rowsQuery\.limit\(limit\)\.offset\(offset\)/);
  assert.match(route, /MAX_FILTER_CANDIDATES = 150/);
  assert.match(route, /description: ""/);
  assert.match(route, /or\(isNull\(jobs\.seniority\)/);
  assert.match(route, /LIST_DESCRIPTION_CHARS = 2_000/);
  assert.match(route, /FILTER_DESCRIPTION_CHARS = 1_000/);
  assert.match(route, /BASE_TECH_SCORE = 5/);
  assert.match(route, /minScore > BASE_TECH_SCORE/);
  assert.match(route, /substr\(\$\{jobs\.description\}/);
  assert.match(route, /const \[rows, eligibleTotals, sourceTotals\]/);
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

test("falha da API não exibe as quatro vagas demonstrativas", async () => {
  const dashboard = await read("../app/Dashboard.tsx");
  assert.match(dashboard, /useState<Job\[]>\(\[\]\)/);
  assert.match(dashboard, /setMode\("unavailable"\)/);
  assert.match(dashboard, /fetchJobsWithRetry/);
  assert.match(dashboard, /searchParams\.set\("degraded", "1"\)/);
  assert.match(dashboard, /modo simplificado/);
  assert.match(dashboard, /Mantendo a última lista carregada/);
  assert.match(dashboard, /sem score/);
  assert.doesNotMatch(dashboard, /score: j\.score \?\? 70/);
  assert.match(dashboard, /const visibleMinScore = simplifiedList \? 0 : effectiveMinScore/);
  assert.match(dashboard, /j\.score >= visibleMinScore/);
  assert.match(dashboard, /simplifiedRetryCountRef\.current >= 3/);
  assert.match(dashboard, /fetchJobsWithRetry\(`\/api\/jobs\?\$\{buildJobsParams\(page\)\}/);
  assert.match(dashboard, /if \(!profileReady\) return;/);
  assert.match(dashboard, /finally\(\(\) => setProfileReady\(true\)\)/);
  assert.match(dashboard, /const profileLoading = !profileReady \|\| mode === "loading"/);
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

test("vaga sem score não recebe veredito de aderência na lista", async () => {
  const dashboard = await read("../app/Dashboard.tsx");
  assert.match(dashboard, /if \(!job\.scored\) return;/);
  assert.match(dashboard, /O veredito só complementa uma aderência calculada/);
});

test("contato existente vira ação de cópia e a espera da captura possui timeout", async () => {
  const [dashboard, route, bridge] = await Promise.all([
    read("../app/Dashboard.tsx"),
    read("../app/api/jobs/[id]/contact/route.ts"),
    read("../extensao-apinfo/radar-bridge.js"),
  ]);
  assert.match(dashboard, /if \(job\.contactEmail\)/);
  assert.match(dashboard, /disabled=\{contactCapturing\}/);
  assert.match(dashboard, /Copiar e-mail/);
  assert.match(dashboard, /navigator\.clipboard\.writeText\(selectedJob\.contactEmail\)/);
  assert.doesNotMatch(dashboard, /Recapturar e-mail/);
  assert.match(dashboard, /12_000/);
  assert.match(route, /isNull\(jobs\.contactEmail\)/);
  assert.match(route, /status: 409/);
  assert.match(bridge, /chrome\.runtime\.lastError/);
});
