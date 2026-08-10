// Substituto real de db/index.ts para os testes de integração do RBAC.
// Usa node:sqlite (nativo, sem dependência nova) por trás de
// drizzle-orm/sqlite-proxy, expondo a mesma função getDb() que
// lib/access.ts espera — mas contra um banco em memória real, não o
// binding do Cloudflare D1.
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import * as schema from "../../db/schema.ts";

let sqliteInstance = globalThis.__RBAC_TEST_SQLITE__;
if (!sqliteInstance) {
  sqliteInstance = new DatabaseSync(":memory:");
  globalThis.__RBAC_TEST_SQLITE__ = sqliteInstance;
}

async function callback(sql, params, method) {
  const stmt = sqliteInstance.prepare(sql);
  if (method === "run") {
    stmt.run(...params);
    return { rows: [] };
  }
  const rows = stmt.all(...params).map(row => Object.values(row));
  return { rows };
}

export function getDb() {
  return drizzle(callback, { schema });
}

export function getRawSqlite() {
  return sqliteInstance;
}
