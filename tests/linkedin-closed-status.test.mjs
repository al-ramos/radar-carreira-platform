import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("importação do LinkedIn mantém vaga fechada fora de novas tentativas", async () => {
  const [normalizer, route] = await Promise.all([
    readFile(new URL("../lib/import-jobs.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/collector/import/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(normalizer, /applicationClosed/);
  assert.match(normalizer, /n\[aã\]o aceita mais candidaturas/);
  assert.match(route, /job\.applicationClosed \? "closed"/);
  assert.match(route, /values\.status === "closed" \? "closed"/);
});
