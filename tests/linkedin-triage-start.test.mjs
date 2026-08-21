import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("acionamento LinkedIn usa recebimento no Radar, sem IA e sem rascunhos", async () => {
  const [route, ui, queue, cron] = await Promise.all([
    readFile(new URL("../app/api/triage/run/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/TriageReport.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/triage/drafts/queue/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/cron/drafts/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /run\.dateScope === "received" \? jobs\.firstSeenAt : jobs\.publishedAt/);
  assert.match(ui, /sourceId: "linkedin-extension", dateScope: "received"/);
  assert.match(ui, /aiMode: "off", createDrafts: false/);
  assert.match(ui, /Analisar LinkedIn recebidas hoje/);
  assert.match(queue, /isDraftAllowedForSource\(row\.job\.sourceId\)/);
  assert.match(cron, /isDraftAllowedForSource\(row\.sourceId\)/);
});
