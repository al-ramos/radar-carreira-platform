import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("envio manual é reconciliado por evidência do Gmail sem autorizar envio automático", async () => {
  const [schema, migration, route, script, screen] = await Promise.all([
    read("../db/schema.ts"),
    read("../drizzle/0028_draft_outbox_sent_tracking.sql"),
    read("../app/api/cron/drafts/route.ts"),
    read("../public/gmail-radarvagas.gs"),
    read("../app/TriageReport.tsx"),
  ]);

  assert.match(schema, /"sent"/);
  assert.match(schema, /gmailSentId/);
  assert.match(schema, /sentAt/);
  assert.match(migration, /draft_subject/);
  assert.match(migration, /gmail_sent_id/);
  assert.match(migration, /sent_at/);
  assert.match(route, /action === "sentCandidates"/);
  assert.match(route, /action === "reconcileSent"/);
  assert.match(route, /requestedOutboxIds \? inArray\(draftOutbox\.id, requestedOutboxIds\)/);
  assert.match(route, /item\.status !== "drafted"/);
  assert.match(route, /normalizeContactEmail\(body\.to\) !== expectedTo/);
  assert.match(route, /body\.subject\?\.trim\(\) !== expectedSubject/);
  assert.match(script, /function reconciliarEnviosManuaisRadar/);
  assert.match(script, /in:sent/);
  assert.match(script, /action:'reconcileSent'/);
  assert.match(script, /payload\.action === 'reconcileSent'/);
  const reconciliation = script.split("function reconciliarEnviosManuaisRadar")[1];
  assert.doesNotMatch(reconciliation, /GmailApp\.sendEmail|GmailApp\.createDraft/);
  assert.match(screen, />Envio</);
  assert.match(screen, /envios confirmados/);
  assert.match(screen, /Ainda não enviado/);
  assert.match(screen, /Atualizar envio/);
});
