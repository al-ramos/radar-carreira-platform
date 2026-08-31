import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("histórico inclui todas as vagas ainda não analisadas quando solicitado", async () => {
  const [route, report] = await Promise.all([
    readFile(new URL("../app/api/triage/history/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/TriageReport.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /\.from\(jobs\)/);
  assert.match(route, /leftJoin\(userJobAnalyses, and\(eq\(userJobAnalyses\.userId, user\.userId\)/);
  assert.match(route, /eq\(userJobAnalyses\.profileRevision, versions\.profileRevision\)/);
  assert.match(route, /eq\(userJobAnalyses\.rulesRevision, versions\.rulesRevision\)/);
  assert.match(route, /eq\(userJobAnalyses\.instructionsRevision, versions\.instructionsRevision\)/);
  assert.match(route, /const pendingScope = scope === "pending"/);
  assert.match(route, /const pendingTriageCondition = sql`not exists \(/);
  assert.match(route, /select 1 from \$\{triageHistory\}/);
  assert.match(route, /\$\{triageHistory\.rulesRevision\} = \$\{versions\.rulesRevision\}/);
  assert.match(route, /triaged: Boolean\(item\.triaged\)/);
  assert.match(route, /label: item\.label \?\? "Aguardando triagem"/);
  assert.match(report, /useState<"pending" \| "analysed" \| "all">\("all"\)/);
  assert.match(report, /item\.source === "pending" \? "Pendente"/);
  assert.match(report, /const isPending = \(item: HistoryItem\) => !item\.triaged/);
  assert.match(report, /\/api\/triage\/history\?scope=pending/);
});

test("busca por código consulta também vagas fora do acervo ativo", async () => {
  const [route, report] = await Promise.all([
    readFile(new URL("../app/api/triage/history/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/TriageReport.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /const codeScope = scope === "code" && Boolean\(code\)/);
  assert.match(route, /instr\(lower\(coalesce\(\$\{jobs\.externalId\}, ''\)\), lower\(\$\{code\}\)\) > 0/);
  assert.match(report, /\/api\/triage\/history\?scope=code&code=\$\{encodeURIComponent\(normalizedCode\)\}/);
});
