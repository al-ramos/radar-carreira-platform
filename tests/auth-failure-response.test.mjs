import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("rotas de acesso sempre respondem JSON, mesmo com o banco fora", async () => {
  const [login, register, helper] = await Promise.all([
    read("../app/api/auth/login/route.ts"),
    read("../app/api/auth/register/route.ts"),
    read("../lib/auth-response.ts"),
  ]);
  for (const route of [login, register]) {
    assert.match(route, /try \{\s*return await handle(Login|Register)\(request\);/);
    assert.match(route, /return authFailureResponse\("auth_(login|register)_failed", error\);/);
  }
  // A cota diária do D1 continua sendo respondida como 429 com resetAt.
  assert.match(helper, /d1QuotaResponse\(error\) \?\?/);
  assert.match(helper, /code: "RADAR_AUTH_UNAVAILABLE"/);
  assert.match(helper, /status: 503/);
});

test("a tela de login não expõe o erro de parse do fetch", async () => {
  const page = await read("../app/login/page.tsx");
  assert.doesNotMatch(page, /await response\.json\(\)/);
  assert.match(page, /const body = await response\.text\(\)/);
  assert.match(page, /return authFailureMessage\(response\.status\)/);
  assert.match(page, /setError\(AUTH_NETWORK_ERROR\)/);
});
