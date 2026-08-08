#!/usr/bin/env node
/**
 * bootstrap-owner.mjs
 *
 * Cria a conta real do owner no banco D1 sem deixar credenciais no Git.
 *
 * USO LOCAL:
 *   node scripts/bootstrap-owner.mjs
 *
 * USO EM PRODUÇÃO (D1 remoto):
 *   npx wrangler d1 execute radar-carreira-platform --remote --command "$(node scripts/bootstrap-owner.mjs --print-sql)"
 *
 * O script:
 *   1. Solicita a senha via stdin (não é exibida)
 *   2. Gera hash PBKDF2-SHA256 com sal aleatório (mesmo algoritmo do Worker)
 *   3. Imprime o INSERT pronto para executar no D1
 *
 * NUNCA commite a saída deste script.
 */

import { createInterface } from "readline";
import { webcrypto } from "crypto";

const OWNER_USER_ID = "radar-local-admin";
const OWNER_EMAIL = "alexsandro.ramos@gmail.com";
const OWNER_NAME = "Alex Ramos";
const HASH_ITERATIONS = 25_000;

function encodeBase64Url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

async function derivePassword(password, salt) {
  const keyMaterial = await webcrypto.subtle.importKey(
    "raw",
    Buffer.from(password, "utf8"),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await webcrypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: HASH_ITERATIONS },
    keyMaterial,
    256
  );
  return new Uint8Array(bits);
}

async function readPassword() {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    process.stderr.write("Nova senha para o owner (mín. 8 caracteres): ");
    // Tenta desabilitar echo se possível
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    rl.question("", (answer) => {
      rl.close();
      process.stderr.write("\n");
      resolve(answer);
    });
  });
}

async function main() {
  const password = await readPassword();

  if (password.length < 8) {
    console.error("Erro: a senha precisa ter no mínimo 8 caracteres.");
    process.exit(1);
  }

  const saltBytes = new Uint8Array(16);
  webcrypto.getRandomValues(saltBytes);
  const salt = encodeBase64Url(saltBytes);

  const hashBytes = await derivePassword(password, saltBytes);
  const hash = encodeBase64Url(hashBytes);

  const now = Date.now();

  const sql = `
-- Execute este SQL UMA VEZ no banco D1 (local ou remoto).
-- Não commite nem compartilhe este arquivo após a execução.
INSERT INTO local_accounts (user_id, email, name, password_hash, password_salt, role, created_by, created_at, updated_at)
VALUES (
  '${OWNER_USER_ID}',
  '${OWNER_EMAIL}',
  '${OWNER_NAME}',
  '${hash}',
  '${salt}',
  'owner',
  NULL,
  ${now},
  ${now}
)
ON CONFLICT(user_id) DO UPDATE SET
  password_hash = excluded.password_hash,
  password_salt = excluded.password_salt,
  role = 'owner',
  updated_at = excluded.updated_at;
`.trim();

  console.log(sql);
  process.stderr.write("\n✅ SQL gerado. Execute-o no D1 e descarte este output.\n");
  process.stderr.write("   Local:  npx wrangler d1 execute radar-carreira-platform --local --file=<arquivo.sql>\n");
  process.stderr.write("   Remoto: npx wrangler d1 execute radar-carreira-platform --remote --file=<arquivo.sql>\n\n");
}

main().catch((err) => {
  console.error("Erro:", err);
  process.exit(1);
});
