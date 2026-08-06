import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("dashboard oferece radar, perfil e pipeline persistente", async () => {
  const dashboard = await read("../app/Dashboard.tsx");
  assert.match(
    dashboard,
    /const nav\s*=\s*\[\s*"Radar",\s*"Pipeline",\s*"Alertas",\s*"Métricas",\s*"Monitoramento",\s*"Auditoria",\s*"Qualidade",\s*"Usuários",\s*"Extensão LinkedIn",\s*"Gmail RadarVagas",\s*"Fontes",\s*"Importações",\s*"Configurações",?\s*\]/,
  );
  assert.match(dashboard, /fetch\(`\/api\/jobs\?limit=250\$\{period \? `&period=\$\{period\}` : ""\}`\)/);
  assert.match(dashboard, /Últimas 24h/);
  assert.match(dashboard, /Últimos 7 dias/);
  assert.match(dashboard, /Todas as vagas/);
  assert.match(dashboard, /Boa aderência \(70%\+\)/);
  assert.match(dashboard, /Alta aderência \(80%\+\)/);
  assert.match(dashboard, /fetch\("\/api\/pipeline"\)/);
  assert.match(dashboard, /fetch\("\/api\/profile"\)/);
  assert.match(dashboard, /Salvas/);
  assert.match(dashboard, /Entrevistas/);
  assert.match(dashboard, /Ofertas/);
  assert.match(dashboard, /gmail-radarvagas\.gs/);
  assert.match(dashboard, /DESCRIÇÃO DA VAGA/);
  assert.match(dashboard, /Copiar descrição/);
  assert.match(dashboard, /outra ferramenta\s+externa/);
  assert.doesNotMatch(dashboard, /MENSAGEM SUGERIDA/);
  assert.match(dashboard, /\/api\/jobs\/detail/);
  assert.match(dashboard, /\[minScore,\s*setMinScore\]\s*=\s*useState\(0\)/);
  assert.match(dashboard, /Mostrar todas as vagas/);
  assert.match(dashboard, /selectedJob\s*=\s*filtered\.find/);
  assert.match(dashboard, /Abrir em tela ampliada/);
  assert.match(dashboard, /Abrir no LinkedIn/);
  assert.match(dashboard, /role="dialog"/);
  assert.match(dashboard, /setDetailJob\(job\)/);
  assert.match(dashboard, /Tecnologias da vaga/);
  assert.match(dashboard, /Stack não informada/);
  assert.match(dashboard, /LinkedInExtension/);
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
