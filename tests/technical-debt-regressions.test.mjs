import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("relatório administrativo exige report.export", async () => {
  const route = await read("../app/api/admin/report/route.ts");
  assert.match(route, /await can\(user,\s*"report\.export"\)/);
  assert.match(route, /status:\s*403/);
});

test("offer pertence ao mesmo conjunto de etapas no schema, API, interface e métricas", async () => {
  const [schema, pipeline, dashboard, analytics] = await Promise.all([
    read("../db/schema.ts"),
    read("../app/api/pipeline/route.ts"),
    read("../app/Dashboard.tsx"),
    read("../app/api/analytics/route.ts"),
  ]);
  assert.match(schema, /stage: text\("stage", \{ enum: \[[^\]]*"offer"/);
  assert.match(pipeline, /VALID_STAGES[^\n]*"offer"/);
  assert.match(pipeline, /"interview" \| "offer" \| "rejected"/);
  assert.match(dashboard, /<option value="offer">🎉 Oferta<\/option>/);
  assert.match(analytics, /"interview","offer","rejected"/);
});

test("configurações operacionais controlam os fluxos correspondentes", async () => {
  const [emailImport, enrich, lifecycle, profile, register, users] = await Promise.all([
    read("../app/api/cron/email-import/route.ts"),
    read("../app/api/cron/enrich/route.ts"),
    read("../lib/lifecycle.ts"),
    read("../app/api/profile/route.ts"),
    read("../app/api/auth/register/route.ts"),
    read("../app/api/admin/users/route.ts"),
  ]);
  assert.match(emailImport, /platformSettings\.emailImportEnabled/);
  assert.match(emailImport, /settings&&!settings\.emailEnabled/);
  assert.match(enrich, /platformSettings\.enrichmentEnabled/);
  assert.match(lifecycle, /config\?\.retentionDays\?\?180/);
  assert.match(lifecycle, /deleteJobsAndRelated/);
  for (const source of [profile, register, users]) {
    assert.match(source, /platformSettings\.defaultMinScore/);
    assert.match(source, /settings\?\.defaultMinScore \?\? 70/);
  }
});

test("backup inclui dados funcionais e RBAC sem exportar hashes de senha", async () => {
  const route = await read("../app/api/admin/backup/route.ts");
  for (const dataset of [
    "profiles", "pipeline", "userJobAnalyses", "jobAiFacts", "aiUsageEvents",
    "roles", "permissions", "rolePermissions", "groups", "groupRoles",
    "userGroups", "userRoles", "accessAuditLog",
  ]) assert.match(route, new RegExp(`\\b${dataset}\\b`));
  assert.doesNotMatch(route, /passwordHash|passwordSalt/);
  assert.match(route, /version:\s*2/);
});

test("loader RBAC preserva a URL de arquivo válida no Windows", async () => {
  const loader = await read("./helpers/db-index-mock-loader.mjs");
  assert.match(loader, /new URL\("\.\/fake-db-index\.mjs", import\.meta\.url\)\.href/);
  assert.doesNotMatch(loader, /pathToFileURL/);
});

test("esteira executa a suíte regular completa e a integração RBAC", async () => {
  const workflow = await read("../.github/workflows/quality.yml");
  assert.match(workflow, /node --test tests\/\*\.test\.mjs/);
  assert.match(workflow, /npm run test:rbac-integration/);
  assert.doesNotMatch(workflow, /node --test tests\/rendered-html\.test\.mjs/);
});
