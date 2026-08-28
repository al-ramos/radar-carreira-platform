import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("a busca por código ignora respostas antigas que chegam fora de ordem", async () => {
  const component = await readFile(new URL("../app/TriageReport.tsx", import.meta.url), "utf8");

  assert.match(component, /const historyRequestVersion = useRef\(0\)/);
  assert.match(component, /const requestVersion = \+\+historyRequestVersion\.current/);
  assert.match(component, /const isCurrentRequest = \(\) => requestVersion === historyRequestVersion\.current/);
  assert.match(component, /const response = await fetch\(historyUrl\);\s*if \(!isCurrentRequest\(\)\) return false;/);
  assert.match(component, /const data = await response\.json\(\).*?;\s*if \(!isCurrentRequest\(\)\) return false;/s);
});
