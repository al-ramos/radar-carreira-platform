import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeProfile } from "../lib/canonical-profile.ts";
import { evaluateDeterministicTriage, needsAiRefinement } from "../lib/deterministic-triage.ts";

const profile = canonicalizeProfile({ userId: "u", seniority: '["Sênior"]', preferredMode: '["Remoto"]', masteredSkills: '["C#", ".NET", "SQL Server"]', desiredAreas: "[]", avoidTerms: "[]", minScore: 60, careerRules: '{"coreStack":["C#", ".NET"],"dailyCommunicationLanguages":["Português"]}', updatedAt: new Date() });
test("triagem determinística produz veredito, score, confiança e lacunas sem IA", () => {
  const value = evaluateDeterministicTriage({ title: "Desenvolvedor .NET Sênior", description: "C# .NET e SQL Server. Remoto, regime CLT.", stack: ["C#", ".NET", "SQL Server"], seniority: "Sênior", workMode: "Remoto" }, profile);
  assert.equal(value.verdict, "BATE"); assert.equal(value.blocker, null); assert.ok(value.score > 0); assert.ok(value.confidence > 0); assert.deepEqual(value.missingSkills, []);
});
test("stack fora do foco não gera bloqueador estrutural", () => {
  const value = evaluateDeterministicTriage({ title: "Desenvolvedor Java", description: "Java e Spring", stack: ["Java", "Spring"] }, profile);
  assert.equal(value.blocker, null); assert.ok(value.missingSkills.includes("Java"));
});

test("não aprova stack principal citada apenas no título ou em tags importadas", () => {
  const value = evaluateDeterministicTriage({
    title: "AI Engineer (Dev .NET)",
    description: "Atuação com GCP, SAP e Angular. Trabalho remoto.",
    stack: ["C#", ".NET"],
  }, profile);
  assert.equal(value.verdict, "BATE");
  assert.equal(value.blocker, null);
  assert.deepEqual(value.matchingSkills, []);
});

test("aceita stack principal explicitamente comprovada no corpo da vaga", () => {
  const value = evaluateDeterministicTriage({
    title: "AI Engineer (Dev .NET)",
    description: "Experiência sólida em desenvolvimento de software utilizando .NET é mandatória.",
    stack: [],
  }, profile);
  assert.equal(value.verdict, "BATE");
  assert.ok(value.matchingSkills.includes(".NET"));
});

test("só encaminha à IA vagas sem bloqueador e com evidências incompletas", () => {
  const clear = evaluateDeterministicTriage({ title: "Desenvolvedor .NET Sênior", description: "C# .NET e SQL Server. Remoto, regime CLT.", stack: ["C#", ".NET", "SQL Server"], seniority: "Sênior", workMode: "Remoto" }, profile);
  const blocked = evaluateDeterministicTriage({ title: "Desenvolvedor Java", description: "Java e Spring", stack: ["Java", "Spring"] }, profile);
  assert.equal(needsAiRefinement(clear).eligible, false);
  assert.equal(needsAiRefinement(blocked).eligible, false);
  assert.deepEqual(needsAiRefinement({ ...clear, confidence: 60 }), { eligible: true, reason: "evidências incompletas sem bloqueador" });
});
