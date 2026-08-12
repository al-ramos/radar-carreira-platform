import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("a API de vagas permite buscar pelo código externo", async () => {
  const route = await readFile(new URL("../app/api/jobs/route.ts", import.meta.url), "utf8");
  assert.match(route, /like\(jobs\.externalId, searchPattern\)/);
});
