import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("telemetria persiste somente métricas operacionais permitidas", async () => {
  const [route, schema, migration] = await Promise.all([
    read("../app/api/telemetry/performance/route.ts"),
    read("../db/schema.ts"),
    read("../drizzle/0045_performance_samples.sql"),
  ]);
  assert.match(route, /performanceSamples/);
  assert.match(route, /crypto\.randomUUID/);
  assert.match(route, /jobs_api_duration/);
  assert.match(route, /jobs_meta_bytes/);
  assert.doesNotMatch(route, /userId:/);
  assert.match(schema, /performance_samples/);
  assert.match(migration, /performance_samples_metric_created_idx/);
});

test("monitoramento calcula p75 e p95 em janelas limitadas", async () => {
  const [route, ui] = await Promise.all([
    read("../app/api/admin/monitor/route.ts"),
    read("../app/Monitoring.tsx"),
  ]);
  assert.match(route, /percentile\(values, 0\.75\)/);
  assert.match(route, /percentile\(values, 0\.95\)/);
  assert.match(route, /limit\(5_000\)/);
  assert.match(route, /Últimas 24 horas/);
  assert.match(route, /Últimos 7 dias/);
  assert.match(ui, /Desempenho percebido/);
  assert.match(ui, /p75/);
  assert.match(ui, /p95/);
});

test("retenção e auditoria D1 são reproduzíveis", async () => {
  const [worker, audit] = await Promise.all([
    read("../worker/index.ts"),
    read("../scripts/d1-query-plan-audit.sql"),
  ]);
  assert.match(worker, /PERFORMANCE_RETENTION_MS = 30/);
  assert.match(worker, /DELETE FROM performance_samples WHERE created_at < \?/);
  assert.match(audit, /EXPLAIN QUERY PLAN/);
  assert.match(audit, /jobs_status_first_seen_idx|WHERE status = 'active'/);
});
