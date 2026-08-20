import assert from "node:assert/strict";
import test from "node:test";
import { analysisVersionsMatch, getAnalysisVersions } from "../lib/analysis-versions.ts";
import { canonicalizeProfile } from "../lib/canonical-profile.ts";

const storedProfile = (overrides = {}) => ({
  userId: "user-1", seniority: '["Sênior"]', preferredMode: '["Remoto"]', masteredSkills: '["C#", ".NET"]',
  desiredAreas: '["Desenvolvimento Back-end"]', avoidTerms: "[]", minScore: 60,
  careerRules: '{"coreStack":["C#", ".NET"],"maxHybridDays":2}', updatedAt: new Date("2026-08-20T12:00:00.000Z"),
  ...overrides,
});

test("reutiliza versões quando o conteúdo efetivo do perfil não mudou", () => {
  const first = getAnalysisVersions(canonicalizeProfile(storedProfile()));
  const sameContent = getAnalysisVersions(canonicalizeProfile(storedProfile({
    updatedAt: new Date("2026-08-20T13:00:00.000Z"),
    masteredSkills: '[".NET", "C#"]',
  })));
  assert.deepEqual(first, sameContent);
  assert.equal(analysisVersionsMatch(first, sameContent), true);
});

test("altera somente a versão da entrada efetivamente modificada", () => {
  const base = getAnalysisVersions(canonicalizeProfile(storedProfile()));
  const changedRules = getAnalysisVersions(canonicalizeProfile(storedProfile({
    careerRules: '{"coreStack":["C#", ".NET"],"maxHybridDays":3}',
  })));
  assert.equal(base.profileRevision, changedRules.profileRevision);
  assert.notEqual(base.rulesRevision, changedRules.rulesRevision);
  assert.equal(base.instructionsRevision, changedRules.instructionsRevision);
  assert.equal(analysisVersionsMatch(base, changedRules), false);
});
