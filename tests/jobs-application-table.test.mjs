import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("a lista entrega datas de candidatura para a tabela principal", async () => {
  const route = await read("../app/api/jobs/route.ts");
  assert.match(route, /const applicationByJobId = new Map/);
  assert.match(route, /generatedAt: applicationByJobId\.get\(job\.id\)\?\.generatedAt/);
  assert.match(route, /sentAt: applicationByJobId\.get\(job\.id\)\?\.sentAt/);
  assert.match(route, /respondedAt: applicationByJobId\.get\(job\.id\)\?\.respondedAt/);
  assert.match(route, /description: job\.description\.slice\(0, 500\)/);
});
