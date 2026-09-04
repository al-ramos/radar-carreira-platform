import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

// A coleta diária ficou vermelha por dias: reconcileJobLifecycle carregava
// todas as colunas de todas as vagas — descrição inclusive — num isolate de
// memória limitada, e a rota respondia 503.
test("a reconciliação lê só as colunas que a decisão usa", async () => {
  const lifecycle = await read("../lib/lifecycle.ts");
  assert.doesNotMatch(lifecycle, /db\.select\(\)\.from\(jobs\)/, "não pode carregar a linha inteira das vagas");
  assert.match(lifecycle, /db\.select\(\{id:jobs\.id,status:jobs\.status,lastSeenAt:jobs\.lastSeenAt\}\)/);
  // Arquivadas são mais da metade do acervo e não mudam de estado: filtrar no
  // SQL evita transportá-las até o laço.
  assert.match(lifecycle, /ne\(jobs\.status,"archived"\)/);
  assert.doesNotMatch(lifecycle, /if\(job\.status==="archived"\)continue/);
});

test("o log da coleta preserva o motivo devolvido pela rota", async () => {
  const workflow = await read("../.github/workflows/collect.yml");
  // Sem --fail-with-body o log só mostrava "curl: (22) ... error: 503".
  assert.doesNotMatch(workflow, /--fail /, "curl --fail descarta o corpo do erro");
  const chamadas = workflow.match(/curl [^\n]*/g) ?? [];
  assert.equal(chamadas.length, 2, "a coleta faz duas chamadas curl");
  for (const chamada of chamadas) {
    assert.ok(chamada.includes("--fail-with-body"), `chamada sem --fail-with-body: ${chamada.slice(0, 60)}`);
  }
});

test("falha ao gravar o batimento não apaga o erro original", async () => {
  const heartbeatLib = await read("../lib/automation-heartbeat.ts");
  assert.match(heartbeatLib, /export async function heartbeat\(id: string, status: Status, error\?: unknown\) \{\s*try \{/);
  assert.match(heartbeatLib, /heartbeat_write_failed/);
  assert.match(heartbeatLib, /async function writeHeartbeat/);
});
