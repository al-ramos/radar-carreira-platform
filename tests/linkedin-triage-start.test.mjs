import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("acionamento manual usa a fonte escolhida e as vagas recebidas no Radar", async () => {
  const [route, ui, preview, queue, cron] = await Promise.all([
    readFile(new URL("../app/api/triage/run/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/TriageReport.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/triage/preview/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/triage/drafts/queue/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/cron/drafts/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /run\.dateScope === "received" \? jobs\.firstSeenAt : jobs\.publishedAt/);
  assert.match(route, /run\.roleArea \? eq\(jobs\.roleArea, run\.roleArea\)/);
  assert.match(route, /run\.ingestionChannel \? eq\(jobs\.ingestionChannel, run\.ingestionChannel\)/);
  assert.match(ui, /sourceId: actionSourceId, dateScope: "received", roleArea: actionArea, ingestionChannel: actionChannel/);
  assert.match(ui, /aiMode: "off", createDrafts: false/);
  assert.match(ui, /Fonte das vagas a analisar/);
  assert.match(ui, /Incluir vagas já triadas/);
  assert.match(preview, /eq\(jobs\.sourceId, sourceId\)/);
  assert.match(preview, /gte\(jobs\.firstSeenAt, window\.start\)/);
  assert.match(preview, /isNull\(userJobAnalyses\.jobId\)/);
  assert.match(queue, /isDraftAllowedForSource\(row\.job\.sourceId\)/);
  assert.match(cron, /isDraftAllowedForSource\(row\.sourceId\)/);
});

test("painel mostra a quantidade real e pede filtros quando o recorte excede o limite seguro", async () => {
  const ui = await readFile(new URL("../app/TriageReport.tsx", import.meta.url), "utf8");
  assert.match(ui, /MAX_MANUAL_TRIAGE_JOBS = 100/);
  assert.match(ui, /Refine Área ou Canal para analisar até/);
  assert.match(ui, /Analisar vagas de hoje/);
});
