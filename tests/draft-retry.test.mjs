import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("retoma falhas de rascunho sem criar duplicidade ou enviar e-mail", async () => {
  const [route, script] = await Promise.all([
    readFile(new URL("../app/api/cron/drafts/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../public/gmail-radarvagas.gs", import.meta.url), "utf8"),
  ]);
  assert.match(route, /retryFailed/);
  assert.match(route, /eq\(draftOutbox\.status, "failed"\)/);
  assert.match(script, /retryFailed:true/);
  assert.match(script, /connectorVersion:RADAR_DRAFT_CONNECTOR_VERSION/);
  assert.match(script, /verificarConectorRascunhosRadar/);
  assert.match(script, /function instalarRascunhosAutomaticosRadar\(\)/);
  assert.match(script, /everyMinutes\(30\)/);
  assert.match(script, /GmailApp\.getDrafts\(\)\.find/);
  assert.match(script, /confirm\.getResponseCode\(\) >= 300/);
  assert.doesNotMatch(script, /GmailApp\.sendEmail\(item\./);
  assert.match(route, /isSafeForDraft/);
  assert.match(route, /status: "cancelled"/);
});
