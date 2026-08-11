import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("extensão APinfo oferece fila de contatos guiada", async () => {
  const [html, dashboard, background, manifest] = await Promise.all([
    read("../extensao-apinfo/dashboard.html"),
    read("../extensao-apinfo/dashboard.js"),
    read("../extensao-apinfo/background.js"),
    read("../extensao-apinfo/manifest.json"),
  ]);
  assert.match(html, /Fila semiassistida/);
  assert.match(html, /id="open-next-contact"/);
  assert.match(dashboard, /CREATE_CONTACT_QUEUE/);
  assert.match(dashboard, /OPEN_NEXT_CONTACT/);
  assert.match(background, /CREATE_CONTACT_QUEUE/);
  assert.match(background, /OPEN_NEXT_CONTACT/);
  assert.match(background, /SKIP_CONTACT_QUEUE_ITEM/);
  assert.match(background, /storage\.local/);
  assert.equal(JSON.parse(manifest).version, "1.4.0");
});
