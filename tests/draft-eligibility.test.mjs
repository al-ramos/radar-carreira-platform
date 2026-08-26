import assert from "node:assert/strict";
import test from "node:test";
import { isDraftAllowedForSource, isEligibleForDraftQueue, isSafeForDraft } from "../lib/draft-eligibility.ts";

test("fila de rascunho exige veredito aproveitável e contato válido", () => {
  assert.equal(isEligibleForDraftQueue({ verdict: "✅", contactEmail: "rh@empresa.com" }), true);
  assert.equal(isEligibleForDraftQueue({ verdict: "🟡", contactEmail: "rh@empresa.com" }), true);
  assert.equal(isEligibleForDraftQueue({ verdict: "❌", contactEmail: "rh@empresa.com" }), false);
  assert.equal(isEligibleForDraftQueue({ verdict: "✅", contactEmail: null }), false);
  assert.equal(isEligibleForDraftQueue({ verdict: "✅", contactEmail: "rh@empresa" }), false);
  assert.equal(isEligibleForDraftQueue({ verdict: "✅", contactEmail: "rh@empresa.com", blocker: "Inglês avançado" }), false);
});

test("aprovação final cria rascunho mesmo com pontuação determinística menor, sem ignorar bloqueador objetivo", () => {
  const base = { verdict: "✅", contactEmail: "rh@empresa.com", blocker: null };
  assert.equal(isSafeForDraft({ ...base, deterministicVerdict: "BATE", deterministicBlocker: null }), true);
  assert.equal(isSafeForDraft({ ...base, deterministicVerdict: "NAO_BATE", deterministicBlocker: null }), true);
  assert.equal(isSafeForDraft({ ...base, deterministicVerdict: "NAO_BATE", deterministicBlocker: "Stack incompatível" }), false);
});

test("LinkedIn só entra na fila de rascunhos quando aprovada e com e-mail válido", () => {
  assert.equal(isDraftAllowedForSource({ sourceId: "linkedin-extension", verdict: "🟡", contactEmail: "rh@empresa.com" }), false);
  assert.equal(isDraftAllowedForSource({ sourceId: "linkedin-extension", verdict: "✅", contactEmail: null }), false);
  assert.equal(isDraftAllowedForSource({ sourceId: "linkedin-extension", verdict: "✅", contactEmail: "rh@empresa.com" }), true);
  assert.equal(isSafeForDraft({ verdict: "🟡", contactEmail: "rh@empresa.com", sourceId: "linkedin-extension", deterministicVerdict: "PROVAVEL" }), false);
  assert.equal(isSafeForDraft({ verdict: "✅", contactEmail: "rh@empresa.com", sourceId: "linkedin-extension", deterministicVerdict: "BATE" }), true);
  assert.equal(isDraftAllowedForSource({ sourceId: "apinfo-extension", verdict: "🟡", contactEmail: null }), true);
});
