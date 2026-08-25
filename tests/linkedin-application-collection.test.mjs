import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const extensionRoot = "C:/Users/al-ra/OneDrive/Documentos/ChatGPT/LINKEDIN/extensao-unificada/";

test("coleta do LinkedIn registra candidatura apenas por código exato", async () => {
  const route = await read("app/api/collector/import/[sourceId]/route.ts");
  assert.match(route, /applicationsFromPayload/);
  assert.match(route, /eq\(jobs\.sourceId, "linkedin-extension"\)/);
  assert.match(route, /inArray\(jobs\.externalId, signals\.map/);
  assert.match(route, /linkedin_application_detected/);
  assert.match(route, /applicationStatus = alreadySent \? existing!\.applicationStatus : "sent"/);
});

test("extensão unificada envia somente confirmações visíveis e usa a nova versão", async () => {
  const [collector, background, manifest, readme] = await Promise.all([
    readFile(`${extensionRoot}linkedin/page-collector.js`, "utf8"),
    readFile(`${extensionRoot}background.js`, "utf8"),
    readFile(`${extensionRoot}manifest.json`, "utf8"),
    readFile(`${extensionRoot}README.md`, "utf8"),
  ]);
  assert.match(collector, /candidatura enviada/);
  assert.match(collector, /externalId:id\|\|undefined/);
  assert.match(background, /applications\}\)\}/);
  assert.match(background, /applicationCandidates=items/);
  assert.match(manifest, /"version": "3\.1\.12"/);
  assert.match(readme, /Coletor de Vagas 3\.1\.12/);
});
