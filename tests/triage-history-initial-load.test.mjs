import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("histórico carrega ao abrir o painel sem depender de filtros", async () => {
  const screen = await readFile(new URL("../app/TriageReport.tsx", import.meta.url), "utf8");
  assert.match(screen, /\[jobSourceFilter, setJobSourceFilter\] = useState\("all"\)/);
  assert.match(screen, /if \(!open\) return;/);
  assert.match(screen, /\}, \[open\]\);/);
});
