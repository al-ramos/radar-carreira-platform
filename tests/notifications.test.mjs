import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("schema e migration registram a tabela de notificações", async () => {
  const [schema, migration, journal] = await Promise.all([
    read("../db/schema.ts"),
    read("../drizzle/0022_notifications.sql"),
    read("../drizzle/meta/_journal.json"),
  ]);
  assert.match(schema, /export const notifications = sqliteTable\("notifications"/);
  assert.match(schema, /type: text\("type", \{ enum: \["import", "report", "digest", "pipeline"\] \}\)/);
  assert.match(schema, /severity: text\("severity", \{ enum: \["success", "error", "info"\] \}\)/);
  assert.match(migration, /CREATE TABLE `notifications`/);
  assert.match(migration, /CREATE INDEX `notifications_created_at_idx`/);
  assert.match(journal, /"0022_notifications"/);
});

test("lib/notifications expõe createNotification e notifyImportRun sem depender de userId", async () => {
  const lib = await read("../lib/notifications.ts");
  assert.match(lib, /export async function createNotification/);
  assert.match(lib, /export async function notifyImportRun/);
  // A notificação é global (ver comentário em db/schema.ts): nada aqui deve
  // gravar ou exigir um userId — só o texto explicativo pode mencionar a
  // palavra, por isso a checagem é no valor gravado, não no arquivo inteiro.
  assert.doesNotMatch(lib, /userId:\s*input/);
  assert.doesNotMatch(lib, /input\.userId/);
});

test("API de notificações restringe leitura e escrita à proprietária", async () => {
  const route = await read("../app/api/notifications/route.ts");
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function POST/);
  assert.match(route, /isOwnerEmail/);
});

test("os seis pontos de conclusão/falha de import_runs notificam o histórico", async () => {
  const routes = await Promise.all([
    read("../app/api/admin/import/route.ts"),
    read("../app/api/collector/import/route.ts"),
    read("../app/api/collector/import/[sourceId]/route.ts"),
    read("../app/api/cron/email-import/route.ts"),
    read("../app/api/cron/collect/route.ts"),
  ]);
  for (const route of routes) assert.match(route, /notifyImportRun/);
});

test("o sino abre o relatório detalhado da importação para quem administra fontes", async () => {
  const [dashboard, bell, styles, report, route] = await Promise.all([
    read("../app/Dashboard.tsx"),
    read("../app/NotificationBell.tsx"),
    read("../app/radar-refinement.css"),
    read("../app/ImportRunReport.tsx"),
    read("../app/api/admin/imports/[id]/route.ts"),
  ]);
  assert.match(dashboard, /import NotificationBell from "\.\/NotificationBell"/);
  assert.match(dashboard, /import ImportRunReport from "\.\/ImportRunReport"/);
  assert.match(dashboard, /canManageSources && <NotificationBell onOpenImportRun=\{setImportReportRunId\}/);
  assert.match(dashboard, /<ImportRunReport runId=\{importReportRunId\}/);
  assert.match(bell, /fetch\("\/api\/notifications"\)/);
  assert.match(bell, /metadata\.runId/);
  assert.match(bell, /onOpenImportRun/);
  assert.match(bell, /notification-bell-badge/);
  assert.match(styles, /\.notification-bell-dropdown/);
  assert.match(styles, /\.import-run-report/);
  assert.match(report, /RELATÓRIO DE IMPORTAÇÃO/);
  assert.match(report, /Vagas afetadas/);
  assert.match(route, /jobImportRuns/);
  assert.match(route, /import\.run/);
});
