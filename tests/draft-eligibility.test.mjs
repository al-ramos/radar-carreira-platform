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

test("aprovação histórica não supera a revalidação determinística atual", () => {
  const base = { verdict: "✅", contactEmail: "rh@empresa.com", blocker: null };
  assert.equal(isSafeForDraft({ ...base, deterministicVerdict: "BATE", deterministicBlocker: null }), true);
  assert.equal(isSafeForDraft({ ...base, deterministicVerdict: "NAO_BATE", deterministicBlocker: "Stack incompatível" }), false);
});

test("LinkedIn é fonte exclusiva de análise e nunca entra na fila de rascunhos", () => {
  assert.equal(isDraftAllowedForSource("linkedin-extension"), false);
  assert.equal(isSafeForDraft({ verdict: "✅", contactEmail: "rh@empresa.com", sourceId: "linkedin-extension", deterministicVerdict: "BATE" }), false);
  assert.equal(isDraftAllowedForSource("apinfo-extension"), true);
});
