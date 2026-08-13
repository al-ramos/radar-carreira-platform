import assert from "node:assert/strict";
import test from "node:test";
import { matchesRequiredStacks } from "../lib/stack-match.ts";

test("combina stacks obrigatórias nos modos todas e qualquer", () => {
  assert.equal(matchesRequiredStacks(["Java", "AWS"], ["Java", "AWS"], "all"), true);
  assert.equal(matchesRequiredStacks(["Java"], ["Java", "AWS"], "all"), false);
  assert.equal(matchesRequiredStacks(["AWS"], ["Java", "AWS"], "any"), true);
  assert.equal(matchesRequiredStacks([], [], "all"), true);
});
