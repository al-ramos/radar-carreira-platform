import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("login local mantém a sessão protegida e oferece a tela de acesso", async () => {
  const [auth, login, logout, page, dashboard] = await Promise.all([
    read("../app/chatgpt-auth.ts"),
    read("../app/api/auth/login/route.ts"),
    read("../app/api/auth/logout/route.ts"),
    read("../app/login/page.tsx"),
    read("../app/Dashboard.tsx"),
  ]);
  assert.doesNotMatch(auth, /RADAR_ADMIN_PASSWORD/);
  assert.match(auth, /RADAR_SESSION_SECRET/);
  assert.match(auth, /HMAC/);
  assert.match(auth, /PBKDF2/);
  assert.match(auth, /httpOnly: true/);
  assert.match(login, /LOCAL_SESSION_COOKIE/);
  assert.doesNotMatch(login, /createLocalAdminSession/);
  assert.match(login, /localAccounts/);
  assert.match(logout, /maxAge: 0/);
  assert.doesNotMatch(page, /notFound\(\)/);
  assert.match(page, /api\/auth\/(?:login|register)/);
  assert.match(page, /safeReturnTo/);
  assert.match(page, /Entrar no Radar/);
  assert.match(dashboard, /\/login\?return_to=\//);
  assert.match(dashboard, /\/api\/auth\/logout/);
});
