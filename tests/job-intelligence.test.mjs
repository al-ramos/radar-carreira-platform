import assert from "node:assert/strict";
import test from "node:test";
import { getAiProviderStatus, validateStructuredJobFacts } from "../lib/ai-provider.ts";
import { buildInterviewBrief } from "../lib/job-intelligence.ts";
import { alexsandroProfilePreset } from "../lib/profile-options.ts";

test("valida e limita fatos estruturados retornados pela IA", () => {
  const facts = validateStructuredJobFacts({
    contract: "Freelancer",
    languageRequirement: "Inglês técnico",
    companyType: "Consultoria",
    businessDomain: "Financeiro",
    cultureSignals: ["Autonomia", 42, "Colaboração"],
    ambiguities: ["Regime não declarado"],
    evidence: [{ finding: "Cultura", excerpt: "trabalho colaborativo" }, { finding: "", excerpt: "inválido" }],
    interviewQuestions: ["Como o time decide a arquitetura?"],
  });
  assert.equal(facts.contract, "Não informado");
  assert.deepEqual(facts.cultureSignals, ["Autonomia", "Colaboração"]);
  assert.deepEqual(facts.evidence, [{ finding: "Cultura", excerpt: "trabalho colaborativo" }]);
});

test("prepara entrevista com narrativa AMR e correção de CAP", () => {
  const rules = alexsandroProfilePreset().careerRules;
  const brief = buildInterviewBrief(validateStructuredJobFacts({ interviewQuestions: [] }), rules, ["Kubernetes"]);
  assert.match(brief.anchor, /Sistema AMR/);
  assert.match(brief.anchor, /COM\+\/MTS\/DTC a CP/);
  assert.match(brief.gaps, /Kubernetes/);
  assert.match(brief.gaps, /sem afirmar prática inexistente/);
});

test("reconhece a configuração OpenAI já usada pelo projeto", () => {
  const previous = { key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL };
  process.env.OPENAI_API_KEY = "chave-de-teste";
  process.env.OPENAI_MODEL = "modelo-de-teste";
  try {
    assert.deepEqual(getAiProviderStatus(), { configured: true, provider: "openai", model: "modelo-de-teste" });
  } finally {
    if (previous.key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous.key;
    if (previous.model === undefined) delete process.env.OPENAI_MODEL; else process.env.OPENAI_MODEL = previous.model;
  }
});
