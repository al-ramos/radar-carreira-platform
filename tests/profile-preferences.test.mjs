import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { allowedWorkModes, listFromStored } from "../lib/profile-options.ts";
import { matchesSelectedSeniority, scoreJob } from "../lib/scoring.ts";

test("preserva preferências novas e legadas como listas", () => {
  assert.deepEqual(listFromStored('["C#", "SQL"]'), ["C#", "SQL"]);
  assert.deepEqual(listFromStored("Sênior, Pleno"), ["Sênior", "Pleno"]);
  assert.deepEqual(allowedWorkModes(["Remoto", "Híbrido", "Presencial"]), ["Remoto", "Presencial"]);
});

test("calcula aderência para mais de uma senioridade e modalidade", () => {
  const result = scoreJob(
    { title: "Engenheira", description: "", stack: [], seniority: "Sênior", workMode: "Remoto" },
    { masteredSkills: [], desiredAreas: [], avoidTerms: [], seniority: ["Pleno", "Sênior"], preferredMode: ["Remoto"] },
  );
  assert.equal(result.score, 20);
  assert.deepEqual(result.reasons, ["Senioridade ideal (+10)", "Modalidade preferida (+10)"]);
});

test("senioridades aceitas excluem vagas de outro nível e vagas sem nível", () => {
  assert.equal(matchesSelectedSeniority("Estágio", ["Estágio"]), true);
  assert.equal(matchesSelectedSeniority("Júnior", ["Estágio"]), false);
  assert.equal(matchesSelectedSeniority(null, ["Estágio"]), false);
  assert.equal(matchesSelectedSeniority(null, []), true);
});

test("pontua stacks de forma proporcional e não confunde nomes parciais", () => {
  const profile = { masteredSkills: ["React", "Node.js", "R"], desiredAreas: [], avoidTerms: [], seniority: [], preferredMode: [] };
  const result = scoreJob({ title: "Pessoa desenvolvedora React", description: "Experiência com React.", stack: ["React"] }, profile);
  assert.equal(result.score, 20);
  assert.deepEqual(result.reasons, ["1 de 3 stacks atendidas (+20)"]);
});

test("perfil usa checkboxes e o radar expõe filtros de visualização", async () => {
  const [profile, dashboard, options] = await Promise.all([
    readFile(new URL("../app/ProfilePreferences.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/profile-options.ts", import.meta.url), "utf8"),
  ]);
  assert.match(profile, /type="checkbox"/);
  assert.match(profile, /<details className="profile-choice-field">/);
  assert.match(profile, /Selecionar todas/);
  assert.match(profile, /Limpar seleção/);
  assert.match(profile, /Competências dominadas/);
  assert.match(profile, /Formato de trabalho/);
  assert.match(profile, /allowCustom=\{false\}/);
  assert.doesNotMatch(profile, /Cidades e regiões/);
  assert.match(profile, /SKILL_GROUPS/);
  assert.match(dashboard, /Tecnologia\s*<select/);
  assert.match(dashboard, /Senioridade\s*<select/);
  assert.match(dashboard, /Modalidade\s*<select/);
  assert.match(dashboard, /event\.key\s*===\s*"Escape"/);
  assert.match(options, /Front-end e mobile/);
  assert.doesNotMatch(options, /Remoto - Brasil/);
  assert.doesNotMatch(options, /"Híbrido"/);
  assert.match(options, /Cloud e DevOps/);
  assert.match(options, /IA, analytics e BI/);
  assert.match(options, /Segurança/);
});
