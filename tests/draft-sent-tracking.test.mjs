import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("todo envio é reconciliado por evidência do Gmail e a reconciliação isolada não envia mensagens", async () => {
  const [schema, migration, threadMigration, integrityMigration, route, queueRoute, historyRoute, script, screen] = await Promise.all([
    read("../db/schema.ts"),
    read("../drizzle/0028_draft_outbox_sent_tracking.sql"),
    read("../drizzle/0034_gmail_thread_tracking.sql"),
    read("../drizzle/0035_draft_tracking_integrity.sql"),
    read("../app/api/cron/drafts/route.ts"),
    read("../app/api/triage/drafts/queue/route.ts"),
    read("../app/api/triage/history/route.ts"),
    read("../public/gmail-radarvagas.gs"),
    read("../app/TriageReport.tsx"),
  ]);

  assert.match(schema, /"sent"/);
  assert.match(schema, /"checking"/);
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
  assert.match(route, /action === "draftCandidates"/);
  assert.match(route, /body\.action === "missing"/);
  assert.match(route, /O Gmail não localizou o rascunho confirmado/);
  assert.match(route, /action === "reconcileSent"/);
  assert.match(route, /body\.action === "reconcileMissing"/);
  assert.match(route, /eq\(draftOutbox\.status, "checking"\)/);
  assert.match(route, /eq\(draftOutbox\.status, "pending"\)/);
  assert.match(route, /recordApplicationSent\(owner\.userId, item\.jobId, sentAt\)/);
  assert.match(route, /searchFrom/);
  assert.match(route, /requestedOutboxIds \? inArray\(draftOutbox\.id, requestedOutboxIds\)/);
  assert.doesNotMatch(route, /Somente rascunhos confirmados podem ser marcados como enviados/);
  assert.match(route, /eq\(draftOutbox\.status, "checking"\)/);
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
  assert.match(script, /action:'reconcileMissing'/);
  assert.match(script, /isDraft:message\.isDraft\(\)/);
  assert.match(script, /payload\.action === 'reconcileSent'/);
  assert.match(script, /const sentMessage = draft\.send\(\)/);
  const createDraft = script.indexOf("GmailApp.createDraft(item.to, item.subject, content.text, content.options)");
  const preventiveCheck = script.indexOf("const alreadySent = encontrarMensagemEnviadaRadar(item)");
  assert.ok(preventiveCheck >= 0 && preventiveCheck < createDraft, "consulta Enviados antes de criar ou enviar uma nova mensagem");
  assert.match(script, /reconciled: result\.reconciled/);
  assert.match(script, /candidate\.searchFrom \|\| candidate\.draftedAt/);
  const reconciliation = script.split("function reconciliarEnviosManuaisRadar")[1];
  assert.doesNotMatch(reconciliation, /GmailApp\.sendEmail|GmailApp\.createDraft/);
  const scheduledReconciliation = script.split("function reconciliarEnviosAgendadosRadar")[1];
  assert.doesNotMatch(scheduledReconciliation, /GmailApp\.sendEmail|GmailApp\.createDraft/);
  assert.match(queueRoute, /status: "checking"/);
  assert.match(queueRoute, /scope: "sent-history-repair"/);
  assert.match(queueRoute, /recordApplicationSent\(user\.userId, requestedJobIds\[0\], now\)/);
  assert.match(historyRoute, /gmailDraftId: draftOutbox\.gmailDraftId/);
  assert.match(historyRoute, /draft\.status === "pending" \|\| draft\.status === "checking"/);
  assert.match(historyRoute, /row\.status === "pending" \|\| row\.status === "checking"/);
  assert.match(screen, /"Envio"/);
  assert.match(screen, /envios registrados/);
  assert.match(screen, /Envio informado manualmente/);
  assert.match(screen, /Envio não confirmado/);
  assert.match(screen, /Verificar envio no Gmail/);
  assert.match(screen, /Envio conciliado sem rascunho do Radar/);
  assert.match(screen, /item\.gmailDraftId \? "Rascunho usado" : "Não houve"/);
  assert.match(screen, /item\.draftStatus === "pending" \|\| item\.draftStatus === "checking"/);
  assert.match(screen, /Confirmar envio/);
  assert.match(screen, /O Gmail ainda não localizou esta mensagem\. Você confirma que já a enviou\?/);
  assert.match(screen, /await confirmSentDraft\(jobId, true\)/);
  assert.match(queueRoute, /action === "confirmSent"/);
  assert.match(queueRoute, /Use Verificar envio primeiro/);
  assert.match(screen, /Tentar novamente/);
  assert.match(screen, /envia automaticamente/);
});
