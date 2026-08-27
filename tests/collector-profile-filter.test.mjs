import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("o filtro preserva código e cargo das vagas rejeitadas pelo perfil", async () => {
  const source = await readFile(new URL("../lib/collector-profile-filter.ts", import.meta.url), "utf8");
  assert.match(source, /rejectedJobs/);
  assert.match(source, /externalId: item\.externalId/);
  assert.match(source, /title: item\.title/);
  assert.match(source, /company: item\.company/);
  assert.match(source, /reason/);
});

test("a importação só usa stack principal quando o perfil pede bloqueio na entrada", async () => {
  const [profile, standardImport, sourceImport] = await Promise.all([
    readFile(new URL("../lib/profile-options.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/collector/import/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/collector/import/[sourceId]/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(profile, /filterImportsByCoreStack/);
  assert.match(standardImport, /careerRules\.filterImportsByCoreStack \? careerRules\.coreStack : \[\]/);
  assert.match(sourceImport, /careerRules\.filterImportsByCoreStack \? careerRules\.coreStack : \[\]/);
});
