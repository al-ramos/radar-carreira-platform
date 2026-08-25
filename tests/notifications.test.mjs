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
  assert.match(schema, /type: text\("type", \{ enum: \["import", "report", "digest", "pipeline", "application", "triage"\] \}\)/);
  assert.match(schema, /severity: text\("severity", \{ enum: \["success", "error", "info"\] \}\)/);
  assert.match(migration, /CREATE TABLE `notifications`/);
  assert.match(migration, /CREATE INDEX `notifications_created_at_idx`/);
  assert.match(journal, /"0022_notifications"/);
});

test("lib/notifications expõe createNotification, notifyImportRun e notifyDraftSent sem depender de userId", async () => {
  const lib = await read("../lib/notifications.ts");
  assert.match(lib, /export async function createNotification/);
  assert.match(lib, /export async function notifyImportRun/);
  assert.match(lib, /export async function notifyDraftSent/);
  assert.match(lib, /export async function notifyDetectedApplication/);
  // A notificação é global (ver comentário em db/schema.ts): nada aqui deve
  // gravar ou exigir um userId — só o texto explicativo pode mencionar a
  // palavra, por isso a checagem é no valor gravado, não no arquivo inteiro.
  assert.doesNotMatch(lib, /userId:\s*input/);
  assert.doesNotMatch(lib, /input\.userId/);
});

test("envio confirmado por reconcileSent notifica o histórico sem alterar o resultado da reconciliação", async () => {
  const [lib, route] = await Promise.all([
    read("../lib/notifications.ts"),
    read("../app/api/cron/drafts/route.ts"),
  ]);
  // notifyDraftSent só descreve algo que o usuário já fez fora do portal —
  // nunca deve chamar Gmail nem qualquer API de envio.
  assert.doesNotMatch(lib, /GmailApp|sendEmail|createDraft/);
  assert.match(lib, /type: "application"/);
  assert.match(route, /import \{ notifyDraftSent \} from "\.\.\/\.\.\/\.\.\/\.\.\/lib\/notifications"/);
  const reconcileSent = route.split('body.action === "reconcileSent"')[1]?.split('body.action === "confirm"')[0] ?? "";
  assert.match(reconcileSent, /status:\s*"sent"/);
  assert.match(reconcileSent, /notifyDraftSent\(/);
  // A notificação é best-effort: uma falha ao notificar não pode reverter
  // nem repetir a reconciliação já gravada em draftOutbox.
  assert.match(reconcileSent, /notifyDraftSent\(db,[^)]*\)\.catch\(/s);
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

test("o sino abre o relatório detalhado de importação, o log da triagem e os detalhes da vaga para quem administra fontes", async () => {
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
  assert.match(dashboard, /onOpenTriageLog=\{\(batchId\) => \{ setTriageLogBatchId\(batchId\); setTriageOpen\(true\); \}\}/);
  assert.match(dashboard, /onOpenJobDetail=\{openNotificationJobDetail\}/);
  assert.match(dashboard, /function openNotificationJobDetail\(jobId: string\)/);
  assert.match(dashboard, /reviewVisibility=all&q=\$\{encodeURIComponent\(jobId\)\}/);
  assert.match(dashboard, /<ImportRunReport runId=\{importReportRunId\}/);
  assert.match(bell, /fetch\("\/api\/notifications"\)/);
  assert.match(bell, /metadata\.runId/);
  assert.match(bell, /onOpenImportRun/);
  assert.match(bell, /onOpenTriageLog/);
  assert.match(bell, /onOpenJobDetail/);
  assert.match(bell, /notification\.type === "triage"/);
  assert.match(bell, /notification\.type === "application"/);
  assert.match(bell, /Abrir log completo/);
  assert.match(bell, /Abrir detalhes da vaga/);
  assert.match(bell, /notification-bell-badge/);
  assert.match(styles, /\.notification-bell-dropdown/);
  assert.match(styles, /\.import-run-report/);
  assert.match(report, /RELATÓRIO DE IMPORTAÇÃO/);
  assert.match(report, /Vagas afetadas/);
  assert.match(report, /Pesquisar no log/);
  assert.match(report, /Esta execução requer atenção/);
  assert.match(report, /Entrada da fonte/);
  assert.match(route, /invalidReasons/);
  assert.match(route, /jobImportRuns/);
  assert.match(route, /import\.run/);
});

test("evidência do LinkedIn marca a candidatura como enviada e notifica apenas uma vez", async () => {
  const [route, dashboard] = await Promise.all([
    read("../app/api/cron/email-import/route.ts"),
    read("../app/Dashboard.tsx"),
  ]);
  assert.match(route, /applicationStatus=alreadySent\?existing!\.applicationStatus:"sent"/);
  assert.match(route, /notifyDetectedApplication\(db/);
  assert.match(route, /if\(!alreadySent\)await notifyDetectedApplication/);
  assert.match(dashboard, /function hasSentApplication\(job: Job\)/);
  assert.match(dashboard, /Uma nova candidatura foi bloqueada/);
  assert.match(dashboard, /disabled=\{hasSentApplication\(selectedJob\)\}/);
});

test("a notificação de triagem destaca o log persistido do lote correspondente", async () => {
  const report = await read("../app/TriageReport.tsx");
  assert.match(report, /highlightBatchId\?: string/);
  assert.match(report, /highlightedBatchItems/);
  assert.match(report, /triage-notification-log/);
  assert.match(report, /LOG COMPLETO DA TRIAGEM AGENDADA/);
  assert.match(report, /scrollIntoView/);
});
