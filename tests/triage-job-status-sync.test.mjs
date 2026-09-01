import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("APIs expõem o estado atual da vaga para a triagem e o detalhe", async () => {
  const [historyRoute, detailRoute, draftRoute] = await Promise.all([
    read("../app/api/triage/history/route.ts"),
    read("../app/api/jobs/detail/route.ts"),
    read("../app/api/triage/drafts/queue/route.ts"),
  ]);

  assert.match(historyRoute, /jobStatus: jobs\.status/);
  assert.match(detailRoute, /jobStatus:job\.status/);
  assert.match(draftRoute, /eq\(jobs\.status, "active"\)/);
});

test("triagem identifica vagas indisponíveis e não inicia novas ações", async () => {
  const source = await read("../app/TriageReport.tsx");

  assert.match(source, /Vaga encerrada na fonte/);
  assert.match(source, /selectedAvailableHistory/);
  assert.match(source, /nenhum e-mail foi preparado/);
  assert.match(source, /\(!item\.jobStatus \|\| item\.jobStatus === "active"\)/);
});

test("detalhe sincroniza encerramento sem apagar o acompanhamento anterior", async () => {
  const source = await read("../app/Dashboard.tsx");

  assert.match(source, /selectedJobUnavailable/);
  assert.match(source, /Estado sincronizado com a fonte/);
  assert.match(source, /acompanhamento anterior preservado/);
  assert.match(source, /disabled=\{selectedJobUnavailable \|\| hasSentApplication/);
  assert.match(source, /!selectedJobUnavailable && selectedApplication\.applicationStatus === "opened"/);
});
