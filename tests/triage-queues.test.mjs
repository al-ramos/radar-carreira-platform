import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("fila da triagem e DLQ são provisionadas sem ativar consumidor prematuro", async () => {
  const [config, workflow] = await Promise.all([
    readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/quality.yml", import.meta.url), "utf8"),
  ]);
  assert.match(config, /"binding": "TRIAGE_QUEUE"/);
  assert.match(config, /"queue": "radar-carreira-triage"/);
  assert.doesNotMatch(config, /"consumers"/);
  assert.match(workflow, /wrangler queues create radar-carreira-triage \|\| true/);
  assert.match(workflow, /wrangler queues create radar-carreira-triage-dlq \|\| true/);
});
