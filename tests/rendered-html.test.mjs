import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("dashboard oferece radar, perfil e pipeline persistente", async () => {
  const dashboard = await read("../app/Dashboard.tsx");
  assert.match(
    dashboard,
    /const nav\s*=\s*\[\s*"Prioridades",\s*"Radar",?\s*\]/,
  );
  assert.match(dashboard, /const followUpNav\s*=\s*\[/);
  assert.match(dashboard, /Acompanhamento/);
  assert.match(dashboard, /const operationalNav\s*=\s*\[/);
  assert.match(dashboard, /Operação e integrações/);
  // Desde o commit 9239c98 (paginação no servidor após filtros), a URL de
  // /api/jobs é montada por buildJobsParams(page), não mais como string
  // literal — verifica a construção real em vez do texto antigo.
  assert.match(dashboard, /const buildJobsParams = useCallback\(/);
  assert.match(dashboard, /limit:\s*"50"/);
  assert.match(dashboard, /fetch\(`\/api\/jobs\?\$\{buildJobsParams\(1\)\}`\)/);
  assert.match(dashboard, /fetchJobsWithRetry\(`\/api\/jobs\?\$\{buildJobsParams\(page\)\}/);
  assert.match(dashboard, /Últimas 24h/);
  assert.match(dashboard, /Últimos 7 dias/);
  assert.match(dashboard, /Sem corte/);
  assert.match(dashboard, /Usar meu perfil \(/);
  assert.match(dashboard, /80% ou mais/);
  assert.match(dashboard, /fetch\("\/api\/pipeline"\)/);
  assert.match(dashboard, /fetch\("\/api\/profile"\)/);
  assert.match(dashboard, /Salvas/);
  assert.match(dashboard, /Entrevistas/);
  assert.match(dashboard, /Visualizadas/);
  assert.match(dashboard, /gmail-radarvagas\.gs/);
  assert.match(dashboard, /DESCRIÇÃO DA VAGA/);
  assert.match(dashboard, /Copiar descrição/);
  assert.match(dashboard, /outra ferramenta\s+externa/);
  assert.doesNotMatch(dashboard, /MENSAGEM SUGERIDA/);
  assert.match(dashboard, /\/api\/jobs\/detail/);
  assert.match(dashboard, /\[fitFilter,\s*setFitFilter\]/);
  assert.match(dashboard, /Mostrar todas as vagas/);
  assert.match(dashboard, /function compactPagination/);
  assert.match(dashboard, /start-ellipsis/);
  assert.match(dashboard, /pagination-ellipsis/);
  assert.match(dashboard, /Página \{currentPage\} de/);
  assert.match(dashboard, /Usar meu perfil/);
  assert.match(dashboard, /score-controls-result/);
  assert.match(dashboard, /selectedJob\s*=\s*filtered\.find/);
  assert.match(dashboard, /Abrir descrição em tela ampliada/);
  assert.match(dashboard, /Candidatar via LinkedIn/);
  assert.match(dashboard, /role="dialog"/);
  assert.match(dashboard, /setDetailJob\(job\)/);
  assert.match(dashboard, /Tecnologias da vaga/);
  assert.match(dashboard, /Stack não informada/);
  assert.match(dashboard, /Impedimentos: requisitos da vaga fora do seu perfil/);
  assert.match(dashboard, /detail-analysis-open/);
  assert.match(dashboard, /const formatJobDate/);
  assert.match(dashboard, /Publicada \{formatJobDateTime\(j\.sourcePublishedAt\)\}/);
  assert.match(dashboard, /Recebida \{formatJobDateTime\(j\.firstSeenAt\)\}/);
  assert.match(dashboard, /LinkedInExtension/);
  const [jobsRoute, dateMigration] = await Promise.all([
    read("../app/api/jobs/route.ts"),
    read("../drizzle/0014_backfill_job_dates.sql"),
  ]);
  assert.match(jobsRoute, /coalesce\(\$\{jobs\.publishedAt\}, \$\{jobs\.firstSeenAt\}\)/);
  assert.match(jobsRoute, /sort === "imported" \? desc\(jobs\.firstSeenAt\)/);
  assert.match(dateMigration, /SET published_at = first_seen_at/);
  const linkedInExtension = await read("../app/LinkedInExtension.tsx");
  assert.match(linkedInExtension, /Importar arquivo do LinkedIn/);
  assert.match(linkedInExtension, /JSON ou CSV/);
  const stackInference = await read("../lib/technology-stack.ts");
  assert.match(stackInference, /inferTechnologyStack/);
  assert.match(stackInference, /SQL Server/);
  assert.match(stackInference, /AWS/);
  const detailRoute = await read("../app/api/jobs/detail/route.ts");
  assert.doesNotMatch(detailRoute, /api\.openai\.com/);
});

test("fontes, coleta agendada e qualidade permanecem configuradas", async () => {
  const [connectors, collectWorkflow, qualityWorkflow] = await Promise.all([
    read("../lib/connectors.ts"),
    read("../.github/workflows/collect.yml"),
    read("../.github/workflows/quality.yml"),
  ]);
  assert.match(connectors, /greenhouse/);
  assert.match(connectors, /lever/);
  assert.match(connectors, /ashby/);
  assert.match(collectWorkflow, /cron: "15 11 \* \* 1-5"/);
  assert.match(qualityWorkflow, /npm run build/);
});

test("identidade visual usa Geist", async () => {
  const [layout, globalCss, platformCss] = await Promise.all([
    read("../app/layout.tsx"),
    read("../app/globals.css"),
    read("../app/platform.css"),
  ]);
  assert.match(layout, /Geist/);
  assert.match(globalCss, /--font-geist/);
  assert.doesNotMatch(platformCss, /Georgia/);
});

test("resumo diário envia vagas pelo Gmail sem duplicação", async () => {
  const route = await read("../app/api/cron/digest/route.ts");
  const connector = await read("../public/gmail-radarvagas.gs");
  assert.match(route, /daily-email:/);
  assert.match(route, /Resumo já enviado hoje/);
  assert.match(route, /alertDeliveries/);
  assert.match(connector, /function enviarResumoDiario/);
  assert.match(connector, /GmailApp\.sendEmail/);
  assert.match(connector, /action:'confirm'/);
});

test("análise personalizada persiste somente vagas elegíveis e prepara orçamento de IA", async () => {
  const [profile, dashboard, schema, analysisRoute, pipelineRoute, aiStatusRoute, careerMigration, analysisMigration, accountingMigration, cleanupMigration] = await Promise.all([
    read("../app/ProfilePreferences.tsx"),
    read("../app/Dashboard.tsx"),
    read("../db/schema.ts"),
    read("../app/api/jobs/[id]/analysis/route.ts"),
    read("../app/api/pipeline/route.ts"),
    read("../app/api/ai/status/route.ts"),
    read("../drizzle/0015_personalized_career_rules.sql"),
    read("../drizzle/0016_user_job_analyses.sql"),
    read("../drizzle/0017_ai_analysis_accounting.sql"),
    read("../drizzle/0018_remove_ineligible_analyses.sql"),
  ]);
  assert.match(profile, /Como o Radar deve representar você/);
  assert.match(profile, /Limite mensal de tokens/);
  assert.match(dashboard, /persistJobAnalysis/);
  assert.match(dashboard, /Abrir no Outlook/);
  assert.match(dashboard, /window\.location\.href = mailto/);
  assert.doesNotMatch(dashboard, /await updateApplicationStatus\(selectedJob, "generated"\)/);
  assert.match(dashboard, /Esta análise é apenas explicativa e não foi adicionada ao acompanhamento/);
  assert.match(dashboard, /AUTOMATIC_ACTION_STAGE\.apply/);
  assert.match(dashboard, /AUTOMATIC_ACTION_STAGE\.analyze/);
  assert.match(dashboard, /<option value="viewed">👁 Visualizada<\/option>/);
  assert.match(dashboard, /onClick=\{\(\) => openJobApplication\(detailJob\)\}/);
  assert.match(schema, /userJobAnalyses/);
  assert.match(schema, /aiUsageEvents/);
  assert.match(analysisRoute, /onConflictDoUpdate/);
  assert.match(analysisRoute, /if \(!result\.eligible\)/);
  assert.match(analysisRoute, /Apenas vagas com veredito Bate ou Provável são registradas/);
  assert.doesNotMatch(pipelineRoute, /analysis\.eligible/);
  assert.match(pipelineRoute, /mode === "advance"/);
  assert.match(pipelineRoute, /onConflictDoUpdate/);
  assert.match(aiStatusRoute, /remainingTokens/);
  assert.match(careerMigration, /career_rules/);
  assert.match(analysisMigration, /user_job_analyses/);
  assert.match(accountingMigration, /ai_usage_events/);
  assert.match(cleanupMigration, /WHERE `verdict` IN \('🔴', '❌'\)/);
});

test("rota de login oferece acesso local em vez de página não encontrada", async () => {
  const login = await read("../app/login/page.tsx");
  assert.match(login, /Entrar no Radar/);
  assert.match(login, /\/api\/auth\/login/);
  assert.match(login, /\/api\/auth\/register/);
  assert.match(login, /safeReturnTo/);
  assert.doesNotMatch(login, /notFound\(/);
});

test("candidatura distingue mensagem gerada, envio e resposta com datas próprias", async () => {
  const [dashboard, schema, applicationRoute, migration] = await Promise.all([
    read("../app/Dashboard.tsx"),
    read("../db/schema.ts"),
    read("../app/api/jobs/[id]/application/route.ts"),
    read("../drizzle/0019_application_tracking.sql"),
  ]);
  assert.match(dashboard, /Mensagem gerada/);
  assert.match(dashboard, /Marcar como enviada/);
  assert.match(dashboard, /Registrar resposta/);
  assert.match(dashboard, /AUTOMATIC_ACTION_STAGE\.copy_email/);
  assert.match(dashboard, /AUTOMATIC_ACTION_STAGE\.open_outlook/);
  assert.match(dashboard, /AUTOMATIC_ACTION_STAGE\.mark_sent/);
  assert.match(dashboard, /AUTOMATIC_ACTION_STAGE\.forward/);
  assert.match(schema, /applicationStatus/);
  assert.match(schema, /generatedAt/);
  assert.match(schema, /sentAt/);
  assert.match(schema, /respondedAt/);
  assert.doesNotMatch(applicationRoute, /analysis\?\.eligible/);
  assert.match(applicationRoute, /requestedRank >= currentRank/);
  assert.match(applicationRoute, /changed: false/);
  assert.match(migration, /application_status/);
  assert.match(migration, /responded_at/);
});

test("IA aprofunda contexto com cache, orçamento e preparação de entrevista", async () => {
  const [dashboard, route, provider, interview] = await Promise.all([
    read("../app/Dashboard.tsx"),
    read("../app/api/jobs/[id]/intelligence/route.ts"),
    read("../lib/ai-provider.ts"),
    read("../lib/job-intelligence.ts"),
  ]);
  assert.match(dashboard, /Aprofundar com IA/);
  assert.match(dashboard, /Evidências encontradas na vaga/);
  assert.match(dashboard, /PREPARAÇÃO PARA ENTREVISTA/);
  assert.match(route, /cached\?\.descriptionHash === descriptionHash/);
  assert.match(route, /blocked_budget/);
  assert.match(route, /aiMonthlyTokenLimit/);
  assert.match(provider, /response_format/);
  assert.match(provider, /Não invente e não use conhecimento externo/);
  assert.match(interview, /COM\+\/MTS\/DTC a CP/);
});

test("triagem por IA fica visível só ao proprietário e consulta job_ai_triage sem expor o backlog por padrão", async () => {
  const [dashboard, route, component, platformCss] = await Promise.all([
    read("../app/Dashboard.tsx"),
    read("../app/api/admin/triage/route.ts"),
    read("../app/TriageReport.tsx"),
    read("../app/platform.css"),
  ]);
  assert.match(dashboard, /import TriageReport from "\.\/TriageReport"/);
  assert.match(dashboard, /\[triageOpen, setTriageOpen\]/);
  assert.match(dashboard, /"Prioridades"/);
  assert.match(dashboard, /item !== "Prioridades" \|\| isOwner/);
  assert.match(dashboard, /\{triageOpen && isOwner && <TriageReport/);
  assert.match(route, /isOwnerEmail\(user\.email\)/);
  assert.match(route, /Acesso restrito ao proprietário/);
  assert.match(route, /includeBacklog/);
  assert.match(route, /!= '⚪'/);
  assert.match(component, /Triagem de vagas/);
  assert.match(component, /CENTRO DE DECISÃO/);
  assert.match(component, /Resumo do filtro atual/);
  assert.match(platformCss, /\.triage-toggle/);
  assert.match(platformCss, /\.triage-row/);
});

test("a tabela permite filtrar colunas e abre detalhes sem reduzir a área de resultados", async () => {
  const [dashboard, css] = await Promise.all([
    read("../app/Dashboard.tsx"),
    read("../app/radar-refinement.css"),
  ]);
  assert.match(dashboard, /tableColumnFilters/);
  assert.match(dashboard, /Filtrar empresa/);
  assert.match(dashboard, /Filtrar por e-mail/);
  assert.match(dashboard, /label: "E-mail"/);
  assert.match(dashboard, /hidden=\{!filtersOpen && activeTableColumnFilterCount === 0\}/);
  assert.match(dashboard, /Limpar filtros de coluna/);
  assert.match(dashboard, /workspace-table-mode/);
  assert.match(dashboard, /detail-drawer/);
  assert.match(css, /\.job-table-filter-row/);
  assert.match(css, /\.detail\.detail-drawer/);
});
