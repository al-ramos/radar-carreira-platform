import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

// T4 — coleta, enriquecimento e ciclo de vida gravavam o mesmo id "collect",
// sobrescrevendo um ao outro, e a coleta não gravava nada.
test("cada automação do ciclo diário tem batimento próprio", async () => {
  const [collect, enrich, lifecycle] = await Promise.all([
    read("../app/api/cron/collect/route.ts"),
    read("../app/api/cron/enrich/route.ts"),
    read("../app/api/cron/lifecycle/route.ts"),
  ]);
  assert.match(collect, /heartbeat\("collect", "running"\)/);
  assert.match(collect, /heartbeat\("collect", errors \? "failed" : "completed"/);
  for (const [rota, id] of [[enrich, "enrich"], [lifecycle, "lifecycle"]]) {
    assert.ok(rota.includes(`heartbeat("${id}","running")`), `sem batimento running: ${id}`);
    assert.ok(rota.includes(`heartbeat("${id}","failed",error)`), `sem batimento failed: ${id}`);
    assert.ok(!rota.includes('heartbeat("collect"'), `${id} ainda grava sob o id collect`);
  }
});

// T4 — "running" preso além da janela não pode continuar parecendo saudável.
test("batimento pendurado vira alerta sem reescrever o banco", async () => {
  const [monitor, ui] = await Promise.all([
    read("../app/api/admin/monitor/route.ts"),
    read("../app/Monitoring.tsx"),
  ]);
  assert.match(monitor, /const staleRunning =/);
  assert.match(monitor, /beat\.status === "running" && beat\.updatedAt\.getTime\(\) < now - schedule\.staleAfterMs/);
  assert.match(monitor, /stuckSchedules\.map\(\(schedule\) => \(\{ level: "error"/);
  assert.match(monitor, /sem conclusão registrada/);
  // O estado é derivado na leitura: nenhuma escrita de batimento no monitor.
  assert.doesNotMatch(monitor, /heartbeat\(/);
  assert.match(ui, /sem conclusão registrada/);
  // A ordem importa: os alertas leem stuckSchedules, que precisa existir antes.
  assert.ok(monitor.indexOf("const stuckSchedules") < monitor.indexOf("const alerts = ["));
});

// T2 parcial / R1 — as automações que emitem batimento precisam aparecer.
test("o painel declara todas as automações que gravam batimento", async () => {
  const monitor = await read("../app/api/admin/monitor/route.ts");
  for (const id of ["collect", "enrich", "lifecycle", "triage-recovery", "triage-dispatch", "triage-backlog-sweep", "draft-monitor", "email-import", "gmail-drafts"]) {
    assert.ok(monitor.includes(`id: "${id}"`), `automação ausente no painel: ${id}`);
  }
  assert.doesNotMatch(monitor, /A cada 2 minutos/, "cadência declarada não corresponde ao cron */15");
});

// R1 — uma chamada autenticada do Apps Script prova que o gatilho está vivo.
test("o conector Gmail registra batimento a cada chamada", async () => {
  const drafts = await read("../app/api/cron/drafts/route.ts");
  assert.match(drafts, /const GMAIL_CONNECTOR = "gmail-drafts"/);
  assert.match(drafts, /await heartbeat\(GMAIL_CONNECTOR, "completed"\)/);
});

// R5 — "Error" era gravado como motivo da falha de um rascunho.
test("falha de rascunho não guarda um motivo vazio", async () => {
  const [heartbeatLib, drafts, connector] = await Promise.all([
    read("../lib/automation-heartbeat.ts"),
    read("../app/api/cron/drafts/route.ts"),
    read("../public/gmail-radarvagas.gs"),
  ]);
  assert.match(heartbeatLib, /export function describeFailure/);
  assert.match(heartbeatLib, /EMPTY_REASON/);
  assert.match(drafts, /describeFailure\(body\.error, "O conector Gmail não informou por que a criação do rascunho falhou\."\)/);
  assert.doesNotMatch(drafts, /body\.error \?\? "Falha ao criar rascunho"/);
  assert.match(connector, /function descreverErroRadar_\(error, etapa\)/);
  assert.match(connector, /descreverErroRadar_\(error, etapa\)/);
  assert.doesNotMatch(connector, /registrarFalhaRascunhoRadar\(secret, item\.outboxId, String\(error\)\)/);
});

test("describeFailure troca formas vazias por um texto utilizável", async () => {
  const source = await read("../lib/automation-heartbeat.ts");
  const match = source.match(/const EMPTY_REASON = (\/.+\/i);/);
  assert.ok(match, "regex de motivo vazio não encontrada");
  const empty = new RegExp(match[1].slice(1, -2), "i");
  for (const vazio of ["Error", "error", "Exception", "[object Object]", "undefined", "null"]) {
    assert.ok(empty.test(vazio), `deveria ser tratado como vazio: ${vazio}`);
  }
  for (const util of ["Invalid to address", "Limite de cota do Gmail atingido", "Errored while sending"]) {
    assert.ok(!empty.test(util), `não deveria ser descartado: ${util}`);
  }
});
