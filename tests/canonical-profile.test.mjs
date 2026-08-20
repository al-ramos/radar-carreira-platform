import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeProfile, profileIsReadyForTriage } from "../lib/canonical-profile.ts";
import { analyzeStackFit } from "../lib/verdict.ts";

test("usa exclusivamente as competências persistidas no perfil canônico", () => {
  const profile = canonicalizeProfile({
    userId: "user-1",
    seniority: '["Sênior"]',
    preferredMode: '["Remoto"]',
    masteredSkills: '["C#", ".NET"]',
    desiredAreas: '["Desenvolvimento Back-end"]',
    avoidTerms: '[]',
    minScore: 70,
    careerRules: '{"coreStack":["C#", ".NET"]}',
    updatedAt: new Date("2026-08-20T12:00:00.000Z"),
  });

  assert.deepEqual(profile.masteredSkills, ["C#", ".NET"]);
  assert.equal(profile.version.toISOString(), "2026-08-20T12:00:00.000Z");
  assert.equal(profileIsReadyForTriage(profile), true);
  assert.deepEqual(analyzeStackFit(["Java"], profile.masteredSkills), {
    requiredSkills: ["Java"], matchingSkills: [], missingSkills: ["Java"],
  });
});

test("não inventa stack quando o perfil não contém competências", () => {
  const profile = canonicalizeProfile({
    userId: "user-2", seniority: "[]", preferredMode: "[]", masteredSkills: "[]",
    desiredAreas: "[]", avoidTerms: "[]", minScore: 60, careerRules: "{}", updatedAt: new Date(),
  });
  assert.equal(profileIsReadyForTriage(profile), false);
  assert.deepEqual(analyzeStackFit(["C#"], profile.masteredSkills), {
    requiredSkills: ["C#"], matchingSkills: [], missingSkills: ["C#"],
  });
});
