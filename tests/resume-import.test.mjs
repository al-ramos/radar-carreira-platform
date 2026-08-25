import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { extractKnownSkills, normalizeResumeSkill, redactResumeContacts } from "../lib/resume-import.ts";
import { validateStructuredResumeFacts } from "../lib/ai-provider.ts";

test("normaliza Visual Basic 6 e VBA vindos de um currículo", () => {
  assert.equal(normalizeResumeSkill("VB6"), "Visual Basic 6");
  assert.equal(normalizeResumeSkill("Visual Basic for Applications"), "VBA");
  const skills = extractKnownSkills("Experiência com VB6, Visual Basic for Applications, C# e .NET.");
  assert.deepEqual(skills.map(skill => skill.name), ["Visual Basic 6", "VBA", "C#", ".NET"]);
});

test("remove contatos antes de encaminhar o currículo à IA", () => {
  const text = redactResumeContacts("Ana · ana@example.com · (11) 99999-1111 · CPF 123.456.789-00");
  assert.match(text, /\[e-mail removido\]/);
  assert.match(text, /\[telefone removido\]/);
  assert.match(text, /\[documento removido\]/);
  assert.doesNotMatch(text, /ana@example\.com|99999-1111|123\.456\.789-00/);
});

test("a resposta da IA exige evidência para cada tecnologia e limita o resumo", () => {
  const facts = validateStructuredResumeFacts({ skills: [{ name: "VBA", confidence: 1, evidence: "Automação com VBA" }, { name: "Java", confidence: 0.9 }], coreStackCandidates: ["VBA"], professionalSummary: "Desenvolvedor com experiência em automação usando VBA." });
  assert.deepEqual(facts.skills, [{ name: "VBA", confidence: 1, evidence: "Automação com VBA" }]);
  assert.deepEqual(facts.coreStackCandidates, ["VBA"]);
  assert.equal(facts.professionalSummary, "Desenvolvedor com experiência em automação usando VBA.");
});

test("a rota limita arquivo, preserva revisão humana e não persiste o PDF", async () => {
  const route = await readFile(new URL("../app/api/profile/resume-extract/route.ts", import.meta.url), "utf8");
  const profile = await readFile(new URL("../app/ProfilePreferences.tsx", import.meta.url), "utf8");
  assert.match(route, /MAX_FILE_SIZE = 10 \* 1024 \* 1024/);
  assert.match(route, /file\.arrayBuffer\(\)/);
  assert.doesNotMatch(route, /\.put\(/);
  const extractor = await readFile(new URL("../lib/resume-import.ts", import.meta.url), "utf8");
  assert.match(extractor, /pdf\.worker\.mjs/);
  assert.match(extractor, /pdfjsWorker/);
  assert.match(profile, /Revise as tecnologias antes de incluí-las/);
  assert.match(profile, /Resumo profissional sugerido/);
  assert.match(profile, /professionalSummary: resumeSummary/);
  assert.match(profile, /Aplicar ao formulário/);
  assert.match(profile, /Não selecionamos nenhuma automaticamente/);
});
