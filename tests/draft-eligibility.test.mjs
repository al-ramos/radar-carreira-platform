import assert from "node:assert/strict";
import test from "node:test";
import { isEligibleForDraftQueue } from "../lib/draft-eligibility.ts";

test("fila de rascunho exige veredito aproveitável e contato válido", () => {
  assert.equal(isEligibleForDraftQueue({ verdict: "✅", contactEmail: "rh@empresa.com" }), true);
  assert.equal(isEligibleForDraftQueue({ verdict: "🟡", contactEmail: "rh@empresa.com" }), true);
  assert.equal(isEligibleForDraftQueue({ verdict: "❌", contactEmail: "rh@empresa.com" }), false);
  assert.equal(isEligibleForDraftQueue({ verdict: "✅", contactEmail: null }), false);
  assert.equal(isEligibleForDraftQueue({ verdict: "✅", contactEmail: "rh@empresa" }), false);
});
