import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("rascunhos automáticos só são enviados depois de autorização explícita", async () => {
  const [queue, cron, connector, workflow, priority, screen] = await Promise.all([
    read("../app/api/triage/drafts/queue/route.ts"),
    read("../app/api/cron/drafts/route.ts"),
    read("../public/gmail-radarvagas.gs"),
    read("../.github/workflows/quality.yml"),
    read("../lib/gmail-draft-priority.ts"),
    read("../app/TriageReport.tsx"),
  ]);
  assert.match(queue, /requestImmediateDraftCreation\(priorityOutboxIds\)/);
  assert.match(queue, /existing\.status === "failed"/);
  assert.match(queue, /markImmediateDraftFailure\(priorityOutboxIds/);
  assert.match(queue, /const immediateDraft = priorityOutboxIds\.length/);
  assert.doesNotMatch(queue, /triagem desta vaga está desatualizada/);
  assert.match(queue, /requestedJobIds\?\.length === 1/);
  assert.match(cron, /outboxIds\?: string\[\]/);
  assert.match(cron, /inArray\(draftOutbox\.id, requestedOutboxIds\)/);
  assert.match(connector, /function doPost\(event\)/);
  assert.match(connector, /payload\.action === 'prioritizeDrafts'/);
  assert.match(connector, /payload\.action === 'health'/);
  assert.match(connector, /payload\.action === 'reconcileSent'/);
  assert.match(connector, /function instalarAutomacaoRascunhosRadar/);
  assert.match(connector, /everyMinutes\(5\)/);
  assert.match(connector, /function reconciliarRascunhosRadar/);
  assert.match(connector, /action:'draftCandidates'/);
  assert.match(connector, /action:'missing'/);
  assert.match(connector, /criarRascunhosRadar\(\{ outboxIds: payload\.outboxIds, autoSend:true \}\)/);
  assert.match(connector, /const sentMessage = draft\.send\(\)/);
  assert.match(connector, /const alreadySent = encontrarMensagemEnviadaRadar\(item\)/);
  assert.match(connector, /envios anteriores conciliados sem reenvio/);
  assert.match(connector, /confirmarRascunhoRadar[\s\S]*draft\.send\(\)/, "a outbox confirma o rascunho antes do envio");
  assert.match(connector, /function confirmarEnvioAutomaticoRadar/);
  assert.match(connector, /gmailSentId:message\.getId\(\)/);
  assert.match(connector, /isDraft:message\.isDraft\(\)/);
  assert.match(connector, /radar-drafts-v4-sent-first/);
  assert.match(connector, /RADAR_CV_FILE_ID/);
  assert.match(connector, /DriveApp\.getFileById/);
  assert.match(connector, /attachments: \[cv\.getBlob\(\)\.setName\(RADAR_CV_FILE_NAME\)\]/);
  assert.match(connector, /existing\.update\(item\.to, item\.subject, content\.text, content\.options\)/);
  assert.match(connector, /contato@amrsolution\.com\.br/);
  assert.doesNotMatch(connector.split("function doPost")[1], /GmailApp\.sendEmail/);
  assert.match(priority, /GMAIL_DRAFTS_WEBHOOK_TOKEN/);
  assert.match(workflow, /GMAIL_DRAFTS_WEBHOOK_URL/);
  assert.match(workflow, /a publicação foi bloqueada/);
  assert.match(screen, /candidatura\(s\) foi\(ram\) enviada\(s\) automaticamente/);
  assert.match(screen, /nenhum novo e-mail foi enviado/);
  assert.match(screen, /Envio automático indisponível/);
  assert.match(screen, /draftActionStatuses/);
  assert.match(screen, /Gmail acionado; atualize em instantes para confirmar o envio/);
  assert.doesNotMatch(screen, /item\.draftStatus === "checking" \|\| item\.draftStatus === "drafted" \|\| item\.draftStatus === "sent"/);
  assert.match(screen, /Aguardando sua confirmação/);
  assert.match(screen, /Tentar novamente/);
  assert.match(screen, /item\.draftError/);
  assert.match(priority, /markImmediateDraftFailure/);
});

test("a autorização automática não é aplicada retroativamente aos rascunhos existentes", async () => {
  const [schema, migration, run, connector, queue] = await Promise.all([
    read("../db/schema.ts"),
    read("../drizzle/0046_authorize_automatic_email_send.sql"),
    read("../app/api/triage/run/route.ts"),
    read("../public/gmail-radarvagas.gs"),
    read("../app/api/triage/drafts/queue/route.ts"),
  ]);
  assert.doesNotThrow(() => new Function(connector), "o Apps Script precisa permanecer sintaticamente válido");
  assert.match(schema, /autoSendAuthorized/);
  assert.match(schema, /autoSendAuthorizedAt/);
  assert.match(migration, /auto_send_authorized` integer DEFAULT false NOT NULL/);
  assert.match(run, /autoSendAuthorized: false, autoSendAuthorizedAt: null/, "a recuperação de aprovações antigas não autoriza envio");
  assert.match(connector, /autoSend && item\.autoSendAuthorized === true/);
  assert.match(queue, /const authorizeAutomaticSend = body\.action === "queue"/);
  assert.match(queue, /existing\.status === "drafted" && authorizeAutomaticSend/);
});
