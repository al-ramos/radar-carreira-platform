import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("histórico não trunca o acervo ativo em mil vagas", async () => {
  const route = await readFile(new URL("../app/api/triage/history/route.ts", import.meta.url), "utf8");

  const historyQuery = route.split("const [batchRows")[0];
  assert.doesNotMatch(historyQuery, /\.limit\(1000\)/);
  assert.match(historyQuery, /fazia o painel estacionar artificialmente em/);
});
