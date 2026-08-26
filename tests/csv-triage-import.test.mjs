import assert from "node:assert/strict";
import test from "node:test";
import { parseCsvTriageImport } from "../lib/csv-triage-import.ts";

test("lê código, status (emoji ou texto) e descrição, aceitando , ou ;", () => {
  const csv = "codigo,status,descricao\n85981,🟡,Provável com ressalvas\n85765,Provável com ressalvas,Oracle no perfil";
  const { rows, rejected } = parseCsvTriageImport(csv);
  assert.equal(rejected.length, 0);
  assert.deepEqual(rows.map((r) => r.externalId), ["85981", "85765"]);
  assert.deepEqual(rows.map((r) => r.verdict), ["🟡", "🟡"]);
  assert.equal(rows[1].description, "Oracle no perfil");
});

test("aceita cabeçalhos acentuados e delimitador ;", () => {
  const csv = "código;status;descrição\n85980;❌;Bloqueador estrutural";
  const { rows } = parseCsvTriageImport(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].verdict, "❌");
});

test("rejeita linha sem código e status não reconhecido, sem descartar em silêncio", () => {
  const csv = "codigo,status,descricao\n,✅,Sem código\n85803,Talvez,Status inválido\n85778,❌,Bloqueada por idioma";
  const { rows, rejected } = parseCsvTriageImport(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].externalId, "85778");
  assert.equal(rejected.length, 2);
  assert.match(rejected[0].reason, /código ausente/);
  assert.match(rejected[1].reason, /não reconhecido/);
});

test("limita a 2000 linhas processadas e ignora arquivo vazio sem erro", () => {
  assert.deepEqual(parseCsvTriageImport(""), { rows: [], rejected: [] });
  const header = "codigo,status,descricao\n";
  const body = Array.from({ length: 2005 }, (_, i) => `${i},✅,ok`).join("\n");
  const { rows } = parseCsvTriageImport(header + body);
  assert.equal(rows.length, 2000);
});

test("prioriza a coluna de veredito final e lê o detalhe da decisão", () => {
  const { rows } = parseCsvTriageImport("código;status;veredito final;detalhe do veredito\n123;❌;🟡;\"Experiência aderente; confirmar idioma\"");
  assert.deepEqual(rows, [{ line: 2, externalId: "123", verdict: "🟡", description: "Experiência aderente; confirmar idioma" }]);
});
