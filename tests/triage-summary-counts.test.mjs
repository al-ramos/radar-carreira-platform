import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("os cartões do histórico usam exatamente o mesmo recorte da tabela", async () => {
  const component = await readFile(new URL("../app/TriageReport.tsx", import.meta.url), "utf8");

  assert.match(component, /Aprovadas no recorte.*?filteredHistory\.filter\(\(item\) => item\.verdict === "✅"\)\.length/s);
  assert.match(component, /Prováveis no recorte.*?filteredHistory\.filter\(\(item\) => item\.verdict === "🟡"\)\.length/s);
  assert.match(component, /Registros no recorte.*?\{filteredHistory\.length\}/s);
  assert.doesNotMatch(component, /item\.triaged && item\.verdict === "✅"/);
});
