import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("abertura de candidatura registra início, sem submeter formulário", async () => {
  const [route, screen, dashboard] = await Promise.all([
    read("../app/api/triage/applications/open/route.ts"),
    read("../app/TriageReport.tsx"),
    read("../app/Dashboard.tsx"),
  ]);

  assert.match(route, /nunca submete formulários/);
  assert.match(route, /job\.status !== "active"/);
  assert.match(route, /application\?\.applicationStatus === "sent" \|\| application\?\.applicationStatus === "responded"/);
  assert.match(route, /applicationStatus: application\?\.applicationStatus === "generated" \? "generated" as const : "opened" as const/);
  assert.match(route, /slice\(0, 20\)/);
  assert.match(screen, /O Radar não envia formulários automaticamente/);
  assert.match(screen, /Candidatura iniciada/);
  assert.match(dashboard, /Confirmar candidatura enviada/);
  assert.match(dashboard, /RADAR_CHECK_LINKEDIN_APPLICATION/);
  assert.match(dashboard, /RADAR_CHECK_LINKEDIN_APPLICATION_RESULT/);
  assert.match(dashboard, /linkedin-status/);
  assert.match(dashboard, /const linkedInExternalId/);
  assert.match(dashboard, /job\.externalId\s*\?\?/);
  assert.match(dashboard, /job\.applyUrl, job\.url/);
  assert.match(dashboard, /const linkedInJobId = linkedInExternalId\(job\)/);
  const linkedInStatus = await read("../app/api/jobs/[id]/linkedin-status/route.ts");
  assert.match(linkedInStatus, /linkedin_application_closed/);
  assert.match(linkedInStatus, /linkedin_application_sent/);
});
