import assert from "node:assert/strict";
import test from "node:test";
import { canClaimTriageWork, triageIdempotencyKey } from "../lib/triage-idempotency.ts";

const versions = { profileRevision: "profile-a", rulesRevision: "rules-a", instructionsRevision: "ai-a" };
test("chave idempotente varia com usuário, vaga e qualquer versão", () => {
  assert.equal(triageIdempotencyKey("u", "j", versions), triageIdempotencyKey("u", "j", versions));
  assert.notEqual(triageIdempotencyKey("u", "j", versions), triageIdempotencyKey("u2", "j", versions));
  assert.notEqual(triageIdempotencyKey("u", "j", versions, 1), triageIdempotencyKey("u", "j", versions, 2));
});
test("lease vencido permite retomada; item concluído nunca é reprocessado", () => {
  const now = new Date("2026-08-20T12:00:00Z");
  assert.equal(canClaimTriageWork({ status: "processing", leaseUntil: new Date("2026-08-20T11:59:59Z") }, now), true);
  assert.equal(canClaimTriageWork({ status: "processing", leaseUntil: new Date("2026-08-20T12:01:00Z") }, now), false);
  assert.equal(canClaimTriageWork({ status: "completed", leaseUntil: null }, now), false);
});
