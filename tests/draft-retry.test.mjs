import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("retoma falhas sem duplicidade e preserva a autorização do envio automático", async () => {
  const [route, queueRoute, script] = await Promise.all([
    readFile(new URL("../app/api/cron/drafts/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/triage/drafts/queue/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../public/gmail-radarvagas.gs", import.meta.url), "utf8"),
  ]);
  assert.match(route, /retryFailed/);
  assert.match(route, /eq\(draftOutbox\.status, "failed"\)/);
  assert.match(script, /retryFailed:true/);
  assert.match(script, /connectorVersion:RADAR_DRAFT_CONNECTOR_VERSION/);
  assert.match(script, /verificarConectorRascunhosRadar/);
  assert.match(script, /GmailApp\.getDrafts\(\)\.find/);
  assert.match(script, /confirm\.getResponseCode\(\) >= 300/);
  assert.doesNotMatch(script, /GmailApp\.sendEmail\(item\./);
  assert.match(route, /isSafeForDraft/);
  assert.match(route, /status: "cancelled"/);
  assert.match(queueRoute, /existing\.status === "failed" \|\| existing\.status === "cancelled"/);
  assert.match(queueRoute, /status: "pending", autoSendAuthorized: authorizeAutomaticSend/);
  assert.match(queueRoute, /autoSendAuthorized: true, autoSendAuthorizedAt: now/);
});
