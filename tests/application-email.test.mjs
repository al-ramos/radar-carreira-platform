import assert from "node:assert/strict";
import test from "node:test";
import { buildApinfoApplicationEmail } from "../lib/application-email.ts";
import { normalizeCareerRules } from "../lib/profile-options.ts";

test("personaliza a candidatura da APinfo somente com stacks confirmadas", () => {
  const body = buildApinfoApplicationEmail({
    title: "Desenvolvedor .NET",
    company: "Artium Soluções",
    externalId: "85079",
    matchingSkills: ["SQL", "PostgreSQL", "SQL"],
    seniority: ["Pleno", "Sênior"],
    applicantName: "Almir Ramos",
  });

  assert.match(body, /equipe de recrutamento da Artium Soluções/);
  assert.match(body, /Desenvolvedor \.NET \(código 85079\)/);
  assert.match(body, /especialmente em SQL, PostgreSQL/);
  assert.match(body, /Atuo em nível Pleno\/Sênior/);
  assert.match(body, /Fico à disposição para encaminhar meu currículo/);
  assert.match(body, /Atenciosamente,\nAlmir Ramos$/);
  assert.doesNotMatch(body, /JavaScript|React|Docker/);
});

test("usa o posicionamento do perfil, explicita lacunas e pergunta o contrato", () => {
  const body = buildApinfoApplicationEmail({
    title: "Arquiteto de Soluções",
    company: "Empresa",
    matchingSkills: ["AWS"],
    missingSkills: ["Kubernetes"],
    seniority: ["Sênior"],
    contractSpecified: false,
    careerRules: normalizeCareerRules({
      professionalTitle: "Arquiteto de Soluções e IA",
      professionalSummary: "Uno estratégia, arquitetura e execução técnica.",
      anchorProject: "um radar de carreira com análise personalizada.",
      discloseGapsInEmail: true,
    }),
    applicantName: "Almir Ramos",
  });

  assert.match(body, /Atuo como Arquiteto de Soluções e IA/);
  assert.match(body, /ainda não tenho experiência comprovada em Kubernetes/);
  assert.match(body, /radar de carreira com análise personalizada/);
  assert.match(body, /regime PJ ou CLT/);
  assert.match(body, /Atenciosamente,\nAlmir Ramos$/);
});

test("mantém uma apresentação segura quando não há stack correspondente", () => {
  const body = buildApinfoApplicationEmail({
    title: "Analista de Sistemas",
    company: "Empresa",
    matchingSkills: [],
    seniority: [],
  });

  assert.match(body, /alinhada à minha experiência profissional/);
  assert.doesNotMatch(body, /boa aderência técnica/);
});
