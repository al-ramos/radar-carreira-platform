import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("pendências de rascunho são reprocessadas automaticamente e registram falhas", async () => {
  const [worker, config, dispatch, screen] = await Promise.all([
    read("../worker/index.ts"),
    read("../wrangler.jsonc"),
    read("../app/api/cron/drafts/dispatch/route.ts"),
    read("../app/TriageReport.tsx"),
  ]);
  assert.match(config, /"\*\/5 \* \* \* \*"/);
  assert.match(worker, /async scheduled\(_event: unknown/);
  assert.match(worker, /api\/cron\/drafts\/dispatch/);
  assert.match(worker, /headers\.delete\("x-radar-draft-dispatch-authenticated"\)/);
  assert.match(dispatch, /eq\(draftOutbox\.status, "pending"\)/);
  assert.match(dispatch, /inArray\(draftOutbox\.id, pending\.map/);
  assert.match(dispatch, /requestImmediateDraftCreation\(pending\.map/);
  assert.match(dispatch, /retryScheduled: !result\.created/);
  assert.match(screen, /Próxima tentativa automática: em até 5 minutos/);
});
