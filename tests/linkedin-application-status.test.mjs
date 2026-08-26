import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("status do LinkedIn aceita somente sinais explícitos e usa a chave da extensão", async () => {
  const source = await read("../app/api/collector/linkedin-status/route.ts");
  assert.match(source, /linkedin-extension/);
  assert.match(source, /submitted.*already_applied.*closed/);
  assert.match(source, /Chave do coletor inválida/);
  assert.match(source, /linkedin_application_confirmed/);
  assert.match(source, /linkedin_application_closed/);
});

test("confirmação avança a candidatura sem baixar uma resposta já registrada", async () => {
  const source = await read("../app/api/collector/linkedin-status/route.ts");
  assert.match(source, /previous === "responded" \? "responded" : "sent"/);
  assert.match(source, /resolveAutomaticStage\(existing\?\.stage, "applied"\)/);
  assert.match(source, /previous !== "sent" && previous !== "responded"/);
});

test("confirmações e encerramentos do LinkedIn aparecem no sino", async () => {
  const source = await read("../app/api/jobs/[id]/linkedin-status/route.ts");
  assert.match(source, /notifyDetectedApplication/);
  assert.match(source, /Vaga encerrada no LinkedIn/);
  assert.match(source, /createNotification/);
});
