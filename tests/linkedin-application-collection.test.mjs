import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("coleta do LinkedIn registra candidatura apenas por código exato", async () => {
  const route = await read("app/api/collector/import/[sourceId]/route.ts");
  assert.match(route, /applicationsFromPayload/);
  assert.match(route, /eq\(jobs\.sourceId, "linkedin-extension"\)/);
  assert.match(route, /inArray\(jobs\.externalId, signals\.map/);
  assert.match(route, /linkedin_application_detected/);
  assert.match(route, /applicationStatus = alreadySent \? existing!\.applicationStatus : "sent"/);
});
