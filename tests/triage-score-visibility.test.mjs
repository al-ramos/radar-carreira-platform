import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("Radar só exibe nota após haver veredito de triagem", async () => {
  const [dashboard, jobsRoute] = await Promise.all([
    readFile(new URL("../app/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/jobs/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(jobsRoute, /triageVerdict: userJobAnalyses\.verdict/);
  assert.match(jobsRoute, /triaged: Boolean\(job\.triageVerdict && job\.triageVerdict !== "⚪"\)/);
  assert.match(dashboard, /const hasVisibleScore = .*job\.scored && job\.triaged/);
  assert.match(dashboard, /A nota de aderência será exibida somente após a triagem/);
  assert.match(dashboard, /aguardando triagem/);
});
