import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("schema e migration registram área, canal e vagas por importação", async () => {
  const [schema, migration] = await Promise.all([read("../db/schema.ts"), read("../drizzle/0021_job_filter_dimensions.sql")]);
  assert.match(schema, /ingestionChannel: text\("ingestion_channel"/);
  assert.match(schema, /roleArea: text\("role_area"/);
  assert.match(schema, /export const jobImportRuns/);
  assert.match(migration, /CREATE TABLE `job_import_runs`/);
  assert.match(migration, /UPDATE `jobs` SET `role_area` = CASE/);
  assert.match(migration, /jobs_source_area_channel_idx/);
});

test("API de vagas filtra dimensões e devolve opções com contagem", async () => {
  const route = await read("../app/api/jobs/route.ts");
  for (const parameter of ["sourceId", "area", "channel", "importRun"]) assert.match(route, new RegExp(`searchParams\\.get\\(\"${parameter}\"\\)`));
  assert.match(route, /exists \(select 1 from \$\{jobImportRuns\}/);
  assert.match(route, /filterOptions:/);
  assert.match(route, /sources: sourceOptionsRows/);
  assert.match(route, /importRuns: recentRuns/);
});

test("Radar apresenta filtros de fonte, área, canal e importação específica", async () => {
  const [dashboard, styles] = await Promise.all([read("../app/Dashboard.tsx"), read("../app/radar-refinement.css")]);
  assert.match(dashboard, /Todas as fontes/);
  assert.match(dashboard, /Área profissional/);
  assert.match(dashboard, /Canal de entrada/);
  assert.match(dashboard, /Importação específica/);
  assert.match(dashboard, /setImportRunFilter/);
  assert.match(styles, /\.area-filter-grid/);
});

test("fluxos principais registram classificação e vínculo com o lote", async () => {
  const routes = await Promise.all([
    read("../app/api/collector/import/[sourceId]/route.ts"),
    read("../app/api/admin/import/route.ts"),
    read("../app/api/cron/email-import/route.ts"),
    read("../app/api/cron/collect/route.ts"),
  ]);
  for (const route of routes) {
    assert.match(route, /inferJobArea/);
    assert.match(route, /recordImportRunJobs/);
  }
});
