#!/usr/bin/env node
/**
 * bootstrap-owner.mjs
 *
 * Gera SQL para criar/atualizar a conta local do owner no banco D1.
 * APENAS SQL vai para stdout — tudo o mais (prompts, avisos, erros) vai para stderr.
 *
 * USO:
 *   node scripts/bootstrap-owner.mjs > /tmp/owner-insert.sql
 *   npx wrangler d1 execute radar-carreira-db --remote --file=/tmp/owner-insert.sql
 *   # Apague o arquivo após executar. Nunca o commite.
 *
 * No PowerShell:
 *   node scripts/bootstrap-owner.mjs > $env:TEMP\owner.sql
 *   npx wrangler d1 execute radar-carreira-db --remote --file=$env:TEMP\owner.sql
 *   Remove-Item $env:TEMP\owner.sql
 */

import { createInterface } from "readline";
import { webcrypto } from "crypto";

const OWNER_USER_ID  = "radar-local-admin";
const OWNER_EMAIL    = "alexsandro.ramos@gmail.com";
const OWNER_NAME     = "Alex Ramos";
const HASH_ITERATIONS = 25_000;

function encodeBase64Url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

async function derivePassword(password, saltBytes) {
  const keyMaterial = await webcrypto.subtle.importKey(
    "raw",
    Buffer.from(password, "utf8"),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await webcrypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations: HASH_ITERATIONS },
    keyMaterial,
    256
  );
  return new Uint8Array(bits);
}

function err(msg) {
  process.stderr.write(msg + "\n");
}

async function readPassword() {
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  return new Promise((resolve) => {
    process.stderr.write("Nova senha para o owner (mín. 8 caracteres): ");
    rl.question("", (answer) => {
      rl.close();
      process.stderr.write("\n");
      resolve(answer);
    });
  });
}

async function main() {
  err("=== bootstrap-owner: geração de SQL para conta local do owner ===");
  err("Tudo que você vê aqui é stderr — não vai para o arquivo SQL.");
  err("");

  const password = await readPassword();

  if (password.length < 8) {
    err("ERRO: a senha precisa ter no mínimo 8 caracteres.");
    process.exit(1);
  }

  const saltBytes = new Uint8Array(16);
  webcrypto.getRandomValues(saltBytes);
  const salt = encodeBase64Url(saltBytes);
  const hashBytes = await derivePassword(password, saltBytes);
  const hash = encodeBase64Url(hashBytes);
  const now = Date.now();

  // --- stdout: apenas SQL válido a partir daqui ---

  // Verifica se o perfil existe (pré-requisito); falha limpo se não existir
  process.stdout.write(
    `-- Verifica pré-requisito: perfil deve existir antes da conta local\n`
  );
  process.stdout.write(
    `-- (Se o SELECT retornar 0 linhas, execute primeiro o bootstrap de perfil)\n`
  );
  process.stdout.write(
    `SELECT COUNT(*) as perfil_existe FROM profiles WHERE user_id = '${OWNER_USER_ID}';\n`
  );
  process.stdout.write(`\n`);

  // Upsert idempotente da conta de autenticação
  process.stdout.write(
    `INSERT INTO local_accounts (user_id, email, name, password_hash, password_salt, created_by, created_at, updated_at)\n`
  );
  process.stdout.write(`VALUES (\n`);
  process.stdout.write(`  '${OWNER_USER_ID}',\n`);
  process.stdout.write(`  '${OWNER_EMAIL}',\n`);
  process.stdout.write(`  '${OWNER_NAME}',\n`);
  process.stdout.write(`  '${hash}',\n`);
  process.stdout.write(`  '${salt}',\n`);
  process.stdout.write(`  NULL,\n`);
  process.stdout.write(`  ${now},\n`);
  process.stdout.write(`  ${now}\n`);
  process.stdout.write(`)\n`);
  process.stdout.write(`ON CONFLICT(user_id) DO UPDATE SET\n`);
  process.stdout.write(`  password_hash = excluded.password_hash,\n`);
  process.stdout.write(`  password_salt = excluded.password_salt,\n`);
  process.stdout.write(`  updated_at    = excluded.updated_at;\n`);

  // --- volta para stderr ---
  err("");
  err("✅ SQL gerado em stdout.");
  err("   Salve em arquivo temporário FORA do repo e execute via wrangler --remote.");
  err("   Apague o arquivo imediatamente após a execução.");
  err("   Guarde a senha no seu gerenciador de senhas agora — ela não é recuperável.");
  err("");
}

main().catch((e) => {
  process.stderr.write(`ERRO fatal: ${e.message}\n`);
  process.exit(1);
});
