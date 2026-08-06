import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("convites criam contas locais com senha derivada e perfis separados", async () => {
  const [auth, users, schema, migration, management, chatgpt] = await Promise.all([
    read("../app/chatgpt-auth.ts"),
    read("../app/api/admin/users/route.ts"),
    read("../db/schema.ts"),
    read("../drizzle/0004_local_accounts.sql"),
    read("../app/UserManagement.tsx"),
    read("../app/api/auth/chatgpt/route.ts"),
  ]);
  assert.match(auth, /PBKDF2/);
  assert.match(auth, /LOCAL_PASSWORD_MIN_LENGTH = 12/);
  assert.match(auth, /createLocalUserSession/);
  assert.match(auth, /host\.endsWith\("\.chatgpt\.site"\)/);
  assert.match(schema, /localAccounts/);
  assert.match(migration, /CREATE TABLE `local_accounts`/);
  assert.match(migration, /password_hash/);
  assert.match(users, /export async function POST/);
  assert.match(users, /hashLocalPassword/);
  assert.match(users, /createdBy: actor.userId/);
  assert.match(management, /Criar convite/);
  assert.match(management, /senha inicial/);
  assert.match(chatgpt, /getHostedChatGPTUser/);
});
