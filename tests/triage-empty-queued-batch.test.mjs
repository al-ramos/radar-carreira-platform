import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("lote manual vazio em fila não bloqueia uma nova triagem", async () => {
  const component = await readFile(new URL("../app/TriageReport.tsx", import.meta.url), "utf8");

  assert.match(component, /const manualIsActive = \(latestManual\?\.status === "queued" \|\| latestManual\?\.status === "running"\) && \(latestManual\.total \?\? 0\) > 0/);
  assert.match(component, /disabled=\{runningPilot \|\| aiReviewLoading \|\| !actionCandidateCount \|\| manualIsActive\}/);
});
