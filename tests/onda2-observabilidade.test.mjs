import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

// T2 — a lista de automações era uma constante escrita à mão, e por isso
// escondia três automações que gravavam batimento sem estar declaradas.
test("automação que grava batimento aparece mesmo sem estar declarada", async () => {
  const monitor = await read("../app/api/admin/monitor/route.ts");
  assert.match(monitor, /const DECLARED_SCHEDULE_IDS = new Set\(\[/);
  assert.match(monitor, /heartbeats\s*\.filter\(\(beat\) => !DECLARED_SCHEDULE_IDS\.has\(beat\.id\)\)/);
  assert.match(monitor, /Automação não declarada no painel/);
  assert.match(monitor, /declared: DECLARED_SCHEDULE_IDS\.has\(schedule\.id\)/);
});

// R2 — "3 pendentes" há dez minutos é operação normal; há seis dias são três
// candidaturas perdidas. A contagem sozinha não separava os dois casos.
test("a fila de rascunhos informa a idade da pendência mais antiga", async () => {
  const worker = await read("../worker/index.ts");
  assert.match(worker, /SELECT COUNT\(\*\) AS total, MIN\(created_at\) AS oldest FROM draft_outbox WHERE status = 'pending'/);
  assert.match(worker, /A mais antiga espera há \$\{Math\.floor\(ageHours \/ 24\)\} dia\(s\)/);
  assert.match(worker, /oldestPendingAgeHours: ageHours/);
  // A copy do painel continua acentuada; ela é lida por gente, não por log.
  assert.match(worker, /aguardam ação explícita no painel/);
});

// A3 — a verificação já existia, mas engolia o motivo da falha num catch vazio
// e não dizia nada sobre as automações.
test("a verificação de saúde registra o motivo e o último batimento", async () => {
  const health = await read("../app/api/health/route.ts");
  assert.doesNotMatch(health, /\}catch\{/, "catch vazio descarta o motivo da falha");
  assert.match(health, /health_check_failed/);
  assert.match(health, /lastAutomation/);
  // Contrato preservado: quem já consumia a rota continua encontrando o mesmo.
  for (const campo of ["status", "database", "responseMs", "checkedAt"]) {
    assert.match(health, new RegExp(`${campo}:`), `campo removido do contrato: ${campo}`);
  }
  assert.match(health, /"healthy"/);
  assert.match(health, /"degraded"/);
});
