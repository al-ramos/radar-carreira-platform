import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { listFromStored } from "../lib/profile-options.ts";
import { scoreJob } from "../lib/scoring.ts";

test("preserva preferências novas e legadas como listas", () => {
  assert.deepEqual(listFromStored('["C#", "SQL"]'), ["C#", "SQL"]);
  assert.deepEqual(listFromStored("Sênior, Pleno"), ["Sênior", "Pleno"]);
});

test("calcula aderência para mais de uma senioridade e modalidade", () => {
  const result = scoreJob(
    { title: "Engenheira", description: "", stack: [], seniority: "Sênior", workMode: "Remoto" },
    { masteredSkills: [], desiredAreas: [], avoidTerms: [], seniority: ["Pleno", "Sênior"], preferredMode: ["Remoto", "Híbrido"], cities: [] },
  );
  assert.equal(result.score, 30);
  assert.deepEqual(result.reasons, ["Senioridade ideal", "Local/modalidade preferida"]);
});

test("perfil usa checkboxes e o radar expõe filtros de visualização", async () => {
  const [profile, dashboard] = await Promise.all([
    readFile(new URL("../app/ProfilePreferences.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/Dashboard.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(profile, /type="checkbox"/);
  assert.match(profile, /Competências dominadas/);
  assert.match(dashboard, /Tecnologia<select/);
  assert.match(dashboard, /Senioridade<select/);
  assert.match(dashboard, /Modalidade<select/);
});
