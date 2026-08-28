import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("Radar só exibe nota após haver veredito de triagem", async () => {
  const [dashboard, jobsRoute] = await Promise.all([
    readFile(new URL("../app/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/jobs/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(jobsRoute, /triageHistoryId: sql<string \| null>`\(/);
  assert.match(jobsRoute, /select \$\{triageHistory\.id\} from \$\{triageHistory\}/);
  assert.match(jobsRoute, /triaged: Boolean\(job\.triageHistoryId\)/);
  assert.match(dashboard, /const hasVisibleScore = .*job\.scored && job\.triaged/);
  assert.match(dashboard, /A nota de aderência será exibida somente após a triagem/);
  assert.match(dashboard, /aguardando triagem/);
});
