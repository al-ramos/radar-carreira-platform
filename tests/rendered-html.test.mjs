import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("dashboard oferece radar, perfil e pipeline persistente", async () => {
  const dashboard = await read("../app/Dashboard.tsx");
  assert.match(dashboard, /const nav=\["Radar","Pipeline","Alertas","Métricas","Monitoramento","Auditoria","Qualidade","Usuários","Gmail RadarVagas","Fontes","Importações","Configurações"\]/);
  assert.match(dashboard, /fetch\(`\/api\/jobs\?limit=250&period=\$\{period\}`\)/);
  assert.match(dashboard, /Últimas 24h/);
  assert.match(dashboard, /Últimos 7 dias/);
  assert.match(dashboard, /fetch\("\/api\/pipeline"\)/);
  assert.match(dashboard, /fetch\("\/api\/profile"\)/);
  assert.match(dashboard, /Salvas/);
  assert.match(dashboard, /Entrevistas/);
  assert.match(dashboard, /Ofertas/);
  assert.match(dashboard, /gmail-radarvagas\.gs/);
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
