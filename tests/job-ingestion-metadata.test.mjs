import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { sourcePublishedJobDate } from "../lib/jobs.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("converte a data do APInfo sem inventar horário de publicação", () => {
  const parsed = sourcePublishedJobDate("13/08/26");
  assert.ok(parsed instanceof Date);
  assert.equal(parsed.getFullYear(), 2026);
  assert.equal(parsed.getMonth(), 7);
  assert.equal(parsed.getDate(), 13);
  assert.equal(sourcePublishedJobDate(undefined), null);
  assert.equal(sourcePublishedJobDate("31/02/26"), null);
});

test("API filtra importações pelo modo e pelo horário exato de recebimento", async () => {
  const route = await read("../app/api/jobs/route.ts");
  assert.match(route, /url\.searchParams\.get\("ingestionMode"\)/);
  assert.match(route, /gte\(jobs\.firstSeenAt, receivedFrom\)/);
  assert.match(route, /lte\(jobs\.firstSeenAt, receivedTo\)/);
  assert.match(route, /sourcePublishedAt: jobs\.sourcePublishedAt/);
  assert.match(route, /sourceName: jobSources\.name/);
  assert.match(route, /gte\(jobs\.firstSeenAt, cutoff\)/);
});

test("o período da Home e as ações da triagem usam a entrada da vaga no Radar", async () => {
  const [jobsRoute, preview, queue, run, aiReview, dashboard, triage] = await Promise.all([
    read("../app/api/jobs/route.ts"),
    read("../app/api/triage/preview/route.ts"),
    read("../app/api/triage/queue/route.ts"),
    read("../app/api/triage/run/route.ts"),
    read("../app/api/triage/ai-review/route.ts"),
    read("../app/Dashboard.tsx"),
    read("../app/TriageReport.tsx"),
  ]);
  for (const route of [jobsRoute, preview, queue, run, aiReview]) assert.match(route, /gte\(jobs\.firstSeenAt, (cutoff|homeCutoff)\)/);
  assert.match(dashboard, /Recebidas 24h/);
  assert.match(triage, /Recebidas nas últimas 24h/);
});

test("interface oferece filtro automático e mostra as duas datas", async () => {
  const dashboard = await read("../app/Dashboard.tsx");
  assert.match(dashboard, /Somente automáticas/);
  assert.match(dashboard, /type="datetime-local"/);
  assert.match(dashboard, /params\.set\("receivedFrom", new Date\(receivedFrom\)\.toISOString\(\)\)/);
  assert.match(dashboard, /Publicada na fonte:/);
  assert.match(dashboard, /Recebida pelo Radar:/);
});

test("histórico da triagem preserva a data de publicação de importações APInfo legadas", async () => {
  const route = await read("../app/api/triage/history/route.ts");
  assert.match(route, /publishedAt: jobs\.publishedAt/);
  assert.match(route, /sourcePublishedAt: item\.sourcePublishedAt \?\? item\.publishedAt/);
  assert.match(route, /\.from\(jobs\)/);
  assert.match(route, /leftJoin\(userJobAnalyses, and\(eq\(userJobAnalyses\.userId, user\.userId\)/);
  assert.match(route, /draftStatus: draftOutbox\.status/);
  assert.match(route, /description: jobs\.description/);
  assert.match(route, /stack: jobs\.stack/);
});

test("migração classifica importações antigas e cria índices do filtro", async () => {
  const migration = await read("../drizzle/0020_job_ingestion_metadata.sql");
  assert.match(migration, /ADD `source_published_at` integer/);
  assert.match(migration, /ADD `ingestion_mode` text NOT NULL DEFAULT 'manual'/);
  assert.match(migration, /SET `ingestion_mode` = 'automatic'/);
  assert.match(migration, /'gmail-radarvagas'/);
  assert.match(migration, /jobs_ingestion_mode_first_seen_idx/);
});
