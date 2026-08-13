import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("filtro, ordenação, detalhe e explicação compartilham o score personalizado", async () => {
  const [dashboard, jobsRoute, detailRoute] = await Promise.all([
    read("../app/Dashboard.tsx"),
    read("../app/api/jobs/route.ts"),
    read("../app/api/jobs/detail/route.ts"),
  ]);
  assert.match(dashboard, /params\.set\("sort", sortOrder === "recent" \? "imported" : "score"\)/);
  assert.match(dashboard, /event\.target\.checked \? "profile" : 0/);
  assert.match(dashboard, /analyzeStackFit\(detailJob\.stack, profileMasteredSkills\)\.missingSkills/);
  assert.match(jobsRoute, /minScore > 0 \|\| verdictFilter !== "all" \|\| sort === "score"/);
  assert.match(detailRoute, /scoreJob\(/);
  assert.match(detailRoute, /\.\.\.match/);
});

test("cache de análise é invalidado quando a versão do perfil muda", async () => {
  const route = await read("../app/api/jobs/[id]/analysis/route.ts");
  assert.match(route, /row\.profileVersion\.getTime\(\) !== profile\.updatedAt\.getTime\(\)/);
  assert.match(route, /analysis: null, stale: true/);
});
