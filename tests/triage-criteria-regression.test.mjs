import assert from "node:assert/strict";
import test from "node:test";
import { alexsandroProfilePreset } from "../lib/profile-options.ts";
import { computeVerdict } from "../lib/verdict.ts";

const preset = alexsandroProfilePreset();
const verdict = (job) => computeVerdict(job, preset.masteredSkills, preset.careerRules);

test("não aprova SAP obrigatório só porque SAP reaparece nos diferenciais", () => {
  const result = verdict({
    title: "Consultor SAP MM Sênior",
    description: "Requisitos obrigatórios: experiência sólida em SAP MM e integrações. Diferenciais: certificação SAP MM.",
    stack: ["SAP"], seniority: "Sênior", workMode: "Híbrido", location: "São Paulo, SP",
  });
  assert.equal(result.emoji, "🔴");
  assert.match(result.rows.find(row => row.criterion === "Fase 3 · Fit técnico")?.status ?? "", /Impedimentos: SAP/);
});

test("SQL ou Office incidentais não transformam cargo de negócio em prioridade técnica", () => {
  const result = verdict({
    title: "Controllership Senior Specialist",
    description: "Atuação contábil e fiscal. Automação de relatórios com Python, SQL e Microsoft Office.",
    stack: ["Python"], seniority: "Sênior", workMode: "Remoto",
  });
  assert.equal(result.emoji, "🔴");
  assert.equal(result.rows.some(row => row.criterion === "Prioridade"), false);
});

test("VBA incidental não aprova uma vaga cuja stack obrigatória é SAP", () => {
  const result = verdict({
    title: "Analista de Segurança SAP",
    description: "Requisitos obrigatórios: SAP Security e GRC. Diferencial: automação de controles com VBA.",
    stack: ["SAP"], seniority: "Sênior", workMode: "Remoto",
  });
  assert.equal(result.emoji, "🔴");
  assert.doesNotMatch(result.rows[0].status, /Foco da vaga compatível/);
});

test("modalidade estruturada presencial prevalece sobre menções remotas no texto", () => {
  const result = verdict({
    title: "Senior Tax Analyst",
    description: "Office-based role. Collaboration with remote teams. Requisitos: REST.",
    stack: ["REST"], seniority: "Sênior", workMode: "Presencial", location: "Bengaluru, India",
  });
  assert.equal(result.emoji, "❌");
  assert.match(result.blocker ?? "", /Presencial fora das regiões aceitas/);
});

test("competência dominada fora da stack central fica provável, não aprovada", () => {
  const result = verdict({
    title: "Pessoa Desenvolvedora React Sênior",
    description: "React obrigatório. CLT.",
    stack: ["React"], seniority: "Sênior", workMode: "Presencial", location: "São Paulo, SP",
  });
  assert.equal(result.emoji, "🟡");
  assert.match(result.rows[0].status, /Stack fora do foco principal/);
});
