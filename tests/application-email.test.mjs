import assert from "node:assert/strict";
import test from "node:test";
import { buildApinfoApplicationEmail } from "../lib/application-email.ts";

test("personaliza a candidatura da APinfo somente com stacks confirmadas", () => {
  const body = buildApinfoApplicationEmail({
    title: "Desenvolvedor .NET",
    company: "Artium Soluções",
    externalId: "85079",
    matchingSkills: ["SQL", "PostgreSQL", "SQL"],
    seniority: ["Pleno", "Sênior"],
    candidateName: "Almir Ramos",
  });

  assert.match(body, /equipe de recrutamento da Artium Soluções/);
  assert.match(body, /Desenvolvedor \.NET \(código 85079\)/);
  assert.match(body, /especialmente em SQL, PostgreSQL/);
  assert.match(body, /Atuo em nível Pleno\/Sênior/);
  assert.match(body, /Atenciosamente,\nAlmir Ramos$/);
  assert.doesNotMatch(body, /JavaScript|React|Docker/);
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
