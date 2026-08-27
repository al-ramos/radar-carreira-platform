import assert from "node:assert/strict";
import test from "node:test";
import { applyAiRefinement } from "../lib/triage-ai-refinement.ts";

const rules = { verdict: "BATE", blocker: null, result: { label: "Aprovada" } };
const facts = (languageRequirement) => ({ contract: "Não informado", languageRequirement, companyType: "Não informado", businessDomain: "Não informado", cultureSignals: [], ambiguities: [], evidence: [], interviewQuestions: [] });

test("IA só rebaixa por evidência objetiva e nunca promove automaticamente", () => {
  assert.equal(applyAiRefinement(rules, facts("Inglês fluente para comunicação diária")).verdict, "NAO_BATE");
  assert.equal(applyAiRefinement({ ...rules, verdict: "PROVAVEL" }, facts("Não informado")).verdict, "PROVAVEL");
});

test("IA respeita inglês aceito explicitamente no perfil", () => {
  const careerRules = { dailyCommunicationLanguages: ["Português", "Inglês"] };
  assert.equal(applyAiRefinement(rules, facts("Inglês fluente para comunicação diária"), careerRules).verdict, "BATE");
});
