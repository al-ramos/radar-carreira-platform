import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("contatos já cadastrados podem ser reaproveitados em lote sem busca externa", async () => {
  const [route, screen] = await Promise.all([
    readFile(new URL("../app/api/triage/contacts/reuse/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/TriageReport.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /companyContacts/);
  assert.match(route, /companyContactKey/);
  assert.match(route, /normalizeContactEmail/);
  assert.match(route, /slice\(0, 100\)/);
  assert.match(route, /Não procura e-mails\s*\* externamente/);
  assert.match(screen, /Consultar contatos já cadastrados/);
  assert.match(screen, /Preparar rascunhos selecionados/);
  assert.match(screen, /Selecionar todas as vagas filtradas/);
  assert.match(screen, /toggleFilteredHistory/);
});
