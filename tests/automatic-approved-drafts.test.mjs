import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("toda aprovação com e-mail válido cria rascunho imediato, sem enviar e-mail", async () => {
  const [run, aiVerdicts, csvImport, settings, migration, docs] = await Promise.all([
    read("../app/api/triage/run/route.ts"),
    read("../lib/apply-ai-verdict.ts"),
    read("../app/api/admin/triage-import/route.ts"),
    read("../app/api/admin/settings/route.ts"),
    read("../drizzle/0033_enable_automatic_approved_drafts.sql"),
    read("../README.md"),
  ]);
  assert.match(run, /if \(finalVerdict\.result\.emoji === "✅" && isSafeForDraft\(/);
  assert.doesNotMatch(run, /safelyRefined/);
  assert.match(run, /const pendingScheduledOutboxIds = await db\.select/);
  assert.match(run, /eq\(draftOutbox\.status, "pending"\)/);
  assert.match(run, /\.limit\(20\)/);
  assert.match(run, /requestImmediateDraftCreation\(pendingScheduledOutboxIds\)/);
  assert.match(run, /const approvedWithoutOutbox = await db\.select/, "a agenda recupera aprovações CSV\/IA que ainda não chegaram à outbox");
  assert.match(run, /eq\(userJobAnalyses\.rulesRevision, versions\.rulesRevision\)/, "a retomada não cria rascunhos para aprovações de uma regra antiga");
  assert.match(aiVerdicts, /if \(entry\.verdict === "✅"\)/);
  assert.match(aiVerdicts, /requestImmediateDraftCreation\(pendingOutboxIds\)/);
  assert.match(csvImport, /requestImmediateDraftCreation\(pendingOutboxIds\)/);
  assert.match(settings, /scheduledTriageDraftQueueEnabled:true/);
  assert.match(settings, /scheduledTriageAutoCreateEnabled:true/);
  assert.match(migration, /scheduled_triage_auto_create_enabled` = true/);
  assert.match(docs, /Isso nunca envia e-mails/);
});
