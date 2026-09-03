import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("fila de análise pelo Codex persiste o recorte e oferece consumo protegido", async () => {
  const [route, screen, schema, migration] = await Promise.all([
    readFile(new URL("../app/api/triage/codex-queue/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/TriageReport.tsx", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0029_triage_codex_queue.sql", import.meta.url), "utf8"),
  ]);
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function POST/);
  assert.match(route, /export async function PATCH/);
  assert.match(route, /destination: "codex"/);
  assert.match(route, /codexStatus: "pending"/);
  assert.match(route, /const canonical = canonicalizeProfile\(profile\)/);
  assert.match(route, /profile: canonical/);
  assert.match(route, /ingestionChannelInput === "all" \? "" : ingestionChannelInput/);
  assert.match(screen, /Preparar para o Codex/);
  assert.match(screen, /\/api\/triage\/codex-queue/);
  assert.match(screen, /const CODEX_BATCH_SIZE = 50/);
  assert.match(screen, /Enviando lote \$\{index \+ 1\} de \$\{batches\.length\}/);
  assert.match(screen, /response\.status === 429/);
  assert.match(screen, /Baixar CSV detalhado/);
  assert.match(screen, /código;título;empresa;local exato;modalidade;contrato;stack \.NET validada;evidências;ressalvas;confirmação/);
  assert.match(screen, /\.map\(csvCell\)\.join\(";"\)/);
  assert.match(screen, /stackValidation/);
  assert.match(screen, /Dados capturados no Radar/);
  assert.match(screen, /Analise todas as triagens pendentes preparadas para o Codex/);
  assert.match(schema, /codexStatus/);
  assert.match(migration, /triage_ai_reviews_codex_queue_idx/);
});
