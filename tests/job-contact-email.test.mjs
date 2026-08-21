import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeContactEmail } from "../lib/jobs.ts";

test("mantém o e-mail preenchido independentemente da origem da vaga", () => {
  for (const origin of ["capturado", "apinfo", "extensão", "automático", "manual"]) {
    assert.equal(normalizeContactEmail(` contato+${origin}@example.com `), `contato+${origin}@example.com`);
  }
});

test("considera ausente um e-mail nulo, indefinido ou vazio", () => {
  assert.equal(normalizeContactEmail(null), undefined);
  assert.equal(normalizeContactEmail(undefined), undefined);
  assert.equal(normalizeContactEmail("   "), undefined);
});

test("a tela de detalhes possui um único campo de e-mail e preserva as ações", async () => {
  const dashboard = await readFile(new URL("../app/Dashboard.tsx", import.meta.url), "utf8");
  assert.equal(dashboard.match(/data-testid="job-contact-email"/g)?.length, 1);
  assert.match(dashboard, /\{selectedJob\.contactEmail && \([\s\S]*?<strong>E-mail:<\/strong>/);
  assert.match(dashboard, /"Copiar e-mail"/);
  assert.match(dashboard, />\s*✉ Abrir no Outlook\s*</);
});

test("candidatar abre a vaga antes de capturar o contato sem bloquear o fluxo", async () => {
  const dashboard = await readFile(new URL("../app/Dashboard.tsx", import.meta.url), "utf8");
  const flow = dashboard.match(/function openJobApplication\(job: Job\) \{([\s\S]*?)\n  \}/)?.[1] ?? "";

  assert.match(flow, /window\.setTimeout\(\(\) => captureApinfoContact\(job\), 1_500\)/);
  assert.ok(flow.indexOf("open(job.applyUrl") < flow.indexOf("captureApinfoContact(job)"));
  assert.doesNotMatch(flow, /await captureApinfoContact/);
  assert.match(flow, /AUTOMATIC_ACTION_STAGE\.apply/);
  assert.match(dashboard, /openJobApplication\(selectedJob\);[\s\S]*?advanceToNextJob\(\);/);
});

test("falha na captura mantém nova tentativa e colagem manual disponíveis", async () => {
  const dashboard = await readFile(new URL("../app/Dashboard.tsx", import.meta.url), "utf8");

  assert.match(dashboard, /setContactPasteReady\(true\);[\s\S]*?Não foi possível capturar o contato/);
  assert.match(dashboard, /"Tentar captura novamente"/);
  assert.match(dashboard, />\s*Colar e-mail\s*</);
  assert.match(dashboard, /onClick=\{\(\) => void pasteApinfoContact\(selectedJob\)\}/);
});

test("contato capturado permanece no campo da vaga e a API persiste a primeira gravação", async () => {
  const [dashboard, route] = await Promise.all([
    readFile(new URL("../app/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/jobs/[id]/contact/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(dashboard, /item\.id === jobId \? \{ \.\.\.item, contactEmail: savedEmail, contactSubject: savedSubject \}/);
  assert.match(dashboard, /r\.status === 409 && persistedEmail/);
  assert.match(route, /\.set\(\{ contactEmail, contactSubject:/);
  assert.match(route, /or\(isNull\(jobs\.contactEmail\), eq\(jobs\.contactEmail, ""\)\)/);
});

test("triagem permite reutilizar o e-mail já cadastrado para a mesma empresa", async () => {
  const [dashboard, route, schema] = await Promise.all([
    readFile(new URL("../app/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/jobs/[id]/contact/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
  ]);
  assert.match(dashboard, /Usar e-mail da empresa/);
  assert.equal(dashboard.match(/Usar e-mail da empresa/g)?.length, 2);
  assert.match(dashboard, /useCompanyContact: true/);
  assert.match(route, /companyContacts/);
  assert.match(route, /useCompanyContact/);
  assert.match(schema, /company_contacts/);
});

test("revalidação APInfo só completa domínio de e-mail salvo incompleto", async () => {
  const [dashboard, route] = await Promise.all([
    readFile(new URL("../app/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/jobs/[id]/contact/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(dashboard, /Verificar no APInfo/);
  assert.match(dashboard, /captureApinfoContact\(selectedJob, true\)/);
  assert.match(route, /correctTruncated/);
  assert.match(route, /contactEmail\.startsWith/);
});
