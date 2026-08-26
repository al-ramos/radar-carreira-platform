import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("envio manual é reconciliado por evidência do Gmail sem autorizar envio automático", async () => {
  const [schema, migration, threadMigration, integrityMigration, route, script, screen] = await Promise.all([
    read("../db/schema.ts"),
    read("../drizzle/0028_draft_outbox_sent_tracking.sql"),
    read("../drizzle/0034_gmail_thread_tracking.sql"),
    read("../drizzle/0035_draft_tracking_integrity.sql"),
    read("../app/api/cron/drafts/route.ts"),
    read("../public/gmail-radarvagas.gs"),
    read("../app/TriageReport.tsx"),
  ]);

  assert.match(schema, /"sent"/);
  assert.match(schema, /gmailSentId/);
  assert.match(schema, /gmailThreadId/);
  assert.match(schema, /sentAt/);
  assert.match(migration, /draft_subject/);
  assert.match(migration, /gmail_sent_id/);
  assert.match(migration, /sent_at/);
  assert.match(threadMigration, /gmail_thread_id/);
  assert.match(integrityMigration, /draft_outbox_gmail_draft_unique/);
  assert.match(integrityMigration, /Rascunho duplicado removido/);
  assert.match(route, /action === "sentCandidates"/);
  assert.match(route, /action === "reconcileSent"/);
  assert.match(route, /requestedOutboxIds \? inArray\(draftOutbox\.id, requestedOutboxIds\)/);
  assert.match(route, /item\.status !== "drafted"/);
  assert.match(route, /normalizeContactEmail\(body\.to\) !== expectedTo/);
  assert.match(route, /body\.subject\?\.trim\(\) !== expectedSubject/);
  assert.match(route, /body\.isDraft !== false/);
  assert.doesNotMatch(route, /matchesStoredThread/);
  assert.match(route, /vinculação duplicada foi bloqueada/);
  assert.match(route, /gmailThreadId/);
  assert.match(script, /function reconciliarEnviosManuaisRadar/);
  assert.doesNotMatch(script, /GmailApp\.getThreadById/);
  assert.match(script, /function instalarVerificacaoEnviosRadar/);
  assert.match(script, /everyMinutes\(15\)/);
  assert.match(script, /function reconciliarEnviosAgendadosRadar/);
  assert.match(script, /function removerVerificacaoEnviosRadar/);
  assert.match(script, /in:sent/);
  assert.match(script, /message\.isDraft\(\)/);
  assert.match(script, /action:'reconcileSent'/);
  assert.match(script, /isDraft:message\.isDraft\(\)/);
  assert.match(script, /payload\.action === 'reconcileSent'/);
  const reconciliation = script.split("function reconciliarEnviosManuaisRadar")[1];
  assert.doesNotMatch(reconciliation, /GmailApp\.sendEmail|GmailApp\.createDraft/);
  const scheduledReconciliation = script.split("function reconciliarEnviosAgendadosRadar")[1];
  assert.doesNotMatch(scheduledReconciliation, /GmailApp\.sendEmail|GmailApp\.createDraft/);
  assert.match(screen, /"Envio"/);
  assert.match(screen, /envios registrados/);
  assert.match(screen, /Envio informado manualmente/);
  assert.match(screen, /Ainda não enviado/);
  assert.match(screen, /Atualizar envio/);
  assert.match(screen, /Confirmar envio/);
  assert.match(screen, /O Gmail ainda não localizou esta mensagem\. Você confirma que já a enviou\?/);
  assert.match(screen, /await confirmSentDraft\(jobId, true\)/);
  const queueRoute = await read("../app/api/triage/drafts/queue/route.ts");
  assert.match(queueRoute, /action === "confirmSent"/);
  assert.match(queueRoute, /Somente um rascunho pronto pode ser confirmado como enviado/);
  assert.match(screen, /Tentar rascunho/);
  assert.match(screen, /não há agendamento/);
});
