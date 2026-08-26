import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("histórico filtra envio APInfo e candidatura das demais fontes no mesmo recorte", async () => {
  const [screen, route] = await Promise.all([
    readFile(new URL("../app/TriageReport.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/triage/history/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(screen, /const hasCompletedOutreach/);
  assert.match(screen, /item\.jobSource === "apinfo-extension"/);
  assert.match(screen, /item\.applicationStatus === "sent"/);
  assert.match(screen, /Envio \/ candidatura/);
  assert.match(screen, /Enviadas \/ candidatas/);
  assert.match(screen, /filteredHistory\.filter\(hasCompletedOutreach\)/);
  assert.ok(screen.indexOf("Envio / candidatura") < screen.indexOf("<details className=\"triage-advanced-filters\""));
  assert.match(route, /applicationStatus: userJobStatus\.applicationStatus/);
  assert.match(route, /leftJoin\(userJobStatus/);
});
