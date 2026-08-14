import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("a extensão escolhe a aba de contato pelo código da vaga", async () => {
  const background = await readFile(new URL("../extensao-apinfo/background.js", import.meta.url), "utf8");

  assert.match(background, /findMostRecentApinfoTab\(externalId\)/);
  assert.match(background, /searchParams\.get\('codvaga'\) === expectedId/);
  assert.match(background, /findMostRecentApinfoTab\(message\.externalId\)/);
  assert.match(background, /página de contato da vaga/);
});
