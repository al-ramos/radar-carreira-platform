import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const route = () => read("../app/api/collector/import/[sourceId]/route.ts");

// O painel do coletor exibia "o banco do Radar está temporariamente
// indisponível" para qualquer exceção da rota, inclusive com o D1 respondendo
// normalmente — o que mandava a investigação para o lugar errado.
test("só culpa o banco quando o erro veio do banco", async () => {
  const source = await route();
  assert.match(source, /function looksLikeDatabaseFailure/);
  assert.match(source, /code: database \? "RADAR_DATABASE_UNAVAILABLE" : "RADAR_IMPORT_FAILED"/);
  assert.match(source, /A importação falhou antes de gravar qualquer vaga/);
  // Nos dois casos o lote continua reenviável: nada foi gravado.
  assert.match(source, /retryable: true/);
});

test("o motivo real chega a quem coleta, não só ao log", async () => {
  const source = await route();
  assert.match(source, /Motivo: \$\{\(detail \|\| "não informado pela rota"\)\.slice\(0, 200\)\}/);
  assert.doesNotMatch(source, /error: error instanceof Error \? error\.message : "Banco indisponível",\s*\}\)\);\s*return json\(\{\s*error: "O banco do Radar/);
});

// Uma importação que falhava depois de action:"status" deixava a execução em
// "running" para sempre, e o coletor recusava a coleta seguinte por já haver
// uma "em andamento".
test("execução pendurada é encerrada antes da coleta seguinte", async () => {
  const source = await route();
  assert.match(source, /const STALE_IMPORT_RUN_MS = 30 \* 60_000/);
  assert.match(source, /async function closeStaleImportRuns/);
  assert.match(source, /eq\(importRuns\.status, "running"\), lt\(importRuns\.startedAt, cutoff\)/);
  assert.match(source, /sem conclusão registrada/);
  // A varredura precisa acontecer antes de processar o lote novo.
  assert.ok(source.indexOf("await closeStaleImportRuns(db, sourceId)") < source.indexOf("const rawItems = Array.isArray"));
});
