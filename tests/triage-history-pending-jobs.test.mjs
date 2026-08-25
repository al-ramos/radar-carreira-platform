import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("histórico inclui vagas ativas ainda não analisadas", async () => {
  const [route, report] = await Promise.all([
    readFile(new URL("../app/api/triage/history/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/TriageReport.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /\.from\(jobs\)/);
  assert.match(route, /leftJoin\(userJobAnalyses, and\(eq\(userJobAnalyses\.userId, user\.userId\)/);
  assert.match(route, /\.where\(eq\(jobs\.status, "active"\)\)/);
  assert.match(route, /label: item\.label \?\? "Aguardando triagem"/);
  assert.match(report, /useState<"pending" \| "analysed" \| "all">\("all"\)/);
  assert.match(report, /item\.source === "pending" \? "Pendente"/);
});
