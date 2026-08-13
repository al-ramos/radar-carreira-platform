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
