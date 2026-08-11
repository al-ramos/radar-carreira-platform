import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("a API de vagas usa a janela inicial configurada quando o período não foi informado", async () => {
  const route = await readFile(new URL("../app/api/jobs/route.ts", import.meta.url), "utf8");
  assert.match(route, /platformSettings/);
  assert.match(route, /configuredPeriod/);
  assert.match(route, /requestedPeriod/);
  assert.match(route, /count/);
  assert.match(route, /contactEmail: jobs\.contactEmail/);
  assert.match(route, /contactSubject: jobs\.contactSubject/);
  assert.match(route, /total/);
});
