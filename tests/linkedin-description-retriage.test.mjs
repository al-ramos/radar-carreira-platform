import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("importação LinkedIn rejeita descrições incompletas e invalida a triagem quando o conteúdo muda", async () => {
  const [collector, helper, run, drafts, cronDrafts, outbox] = await Promise.all([
    read("../app/api/collector/import/route.ts"),
    read("../lib/current-triage.ts"),
    read("../app/api/triage/run/route.ts"),
    read("../app/api/triage/drafts/queue/route.ts"),
    read("../app/api/cron/drafts/route.ts"),
    read("../lib/approved-draft-outbox.ts"),
  ]);

  assert.match(collector, /description\?\.trim\(\)\.length.*>= 80/);
  assert.match(collector, /triageInputChanged/);
  assert.match(collector, /triageInputUpdatedAt/);
  assert.match(collector, /status: "cancelled"/);
  assert.match(collector, /aguardando nova triagem/);
  assert.match(helper, /triageHistory\.createdAt.*jobs\.triageInputUpdatedAt/s);
  assert.match(run, /triageIdempotencyKey\(userId, job\.id, versions, job\.triageInputUpdatedAt\)/);
  assert.match(drafts, /gte\(userJobAnalyses\.updatedAt, jobs\.triageInputUpdatedAt\)/);
  assert.match(drafts, /gte\(triageHistory\.createdAt, jobs\.triageInputUpdatedAt\)/);
  assert.match(cronDrafts, /gte\(triageHistory\.createdAt, jobs\.triageInputUpdatedAt\)/);
  assert.match(cronDrafts, /gte\(userJobAnalyses\.updatedAt, jobs\.triageInputUpdatedAt\)/);
  assert.match(outbox, /existing\.status !== "cancelled"/);
  assert.match(outbox, /gmailDraftId: null/);
});

test("todos os caminhos de classificação bloqueiam vagas sem descrição íntegra", async () => {
  const paths = [
    "../app/api/triage/queue/route.ts",
    "../app/api/triage/run/route.ts",
    "../app/api/triage/ai-review/route.ts",
    "../app/api/triage/codex-queue/route.ts",
  ];
  for (const path of paths) assert.match(await read(path), /hasTriageableDescription\(\)/, path);
});
