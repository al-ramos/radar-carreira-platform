import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("atalho da triagem abre a vaga pelo identificador interno exato", async () => {
  const [dashboard, jobsRoute] = await Promise.all([
    readFile(new URL("../app/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/jobs/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(dashboard, /const \[focusedJobId, setFocusedJobId\] = useState<string \| null>\(null\)/);
  assert.match(dashboard, /if \(focusedJobId\) params\.set\("jobId", focusedJobId\)/);
  assert.match(dashboard, /setFocusedJobId\(job\.jobId\)/);
  assert.match(dashboard, /focusedJobId === j\.id/);
  assert.match(jobsRoute, /const requestedJobId = \(url\.searchParams\.get\("jobId"\) \?\? ""\)\.trim\(\)/);
  assert.match(jobsRoute, /const condition = requestedJobId[\s\S]*eq\(jobs\.id, requestedJobId\)/);
});
