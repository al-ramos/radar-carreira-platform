import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTriageRunRequest, saoPauloDayWindow } from "../lib/triage-orchestrator.ts";

test("todos os acionadores usam o mesmo contrato e padrão de São Paulo", () => {
  const now = new Date("2026-08-20T02:30:00.000Z");
  for (const trigger of ["portal", "schedule", "gpt"]) {
    assert.deepEqual(normalizeTriageRunRequest({ trigger }, now), {
      trigger, referenceDate: "2026-08-19", batchSize: 10, reprocess: false, aiMode: "ambiguous", createDrafts: false, dateScope: trigger === "schedule" ? "received" : "published",
    });
  }
});

test("normaliza parâmetros de execução e limita o lote assíncrono", () => {
  assert.deepEqual(normalizeTriageRunRequest({ trigger: "portal", referenceDate: "2026-08-20", batchSize: 9999, reprocess: true, aiMode: "off", createDrafts: true }), {
    trigger: "portal", referenceDate: "2026-08-20", batchSize: 1000, reprocess: true, aiMode: "off", createDrafts: true, dateScope: "published",
  });
});

test("LinkedIn pode pedir explicitamente o recorte por recebimento no Radar", () => {
  assert.deepEqual(normalizeTriageRunRequest({ trigger: "portal", sourceId: "linkedin-extension", dateScope: "received" }, new Date("2026-08-20T12:00:00.000Z")), {
    trigger: "portal", sourceId: "linkedin-extension", referenceDate: "2026-08-20", batchSize: 10, reprocess: false, aiMode: "ambiguous", createDrafts: false, dateScope: "received",
  });
});

test("preserva filtros manuais do Radar na execução do dia", () => {
  assert.deepEqual(normalizeTriageRunRequest({ trigger: "portal", sourceId: "apinfo-extension", dateScope: "received", roleArea: "engineering", ingestionChannel: "connector" }, new Date("2026-08-20T12:00:00.000Z")), {
    trigger: "portal", sourceId: "apinfo-extension", roleArea: "engineering", ingestionChannel: "connector", referenceDate: "2026-08-20", batchSize: 10, reprocess: false, aiMode: "ambiguous", createDrafts: false, dateScope: "received",
  });
});

test("preserva o período ativo da Home na execução manual", () => {
  assert.deepEqual(normalizeTriageRunRequest({ trigger: "portal", sourceId: "linkedin-extension", homePeriod: "24" }, new Date("2026-08-20T12:00:00.000Z")), {
    trigger: "portal", sourceId: "linkedin-extension", homePeriod: "24", referenceDate: "2026-08-20", batchSize: 10, reprocess: false, aiMode: "ambiguous", createDrafts: false, dateScope: "published",
  });
});

test("recorta o dia agendado no calendário de São Paulo", () => {
  const window = saoPauloDayWindow("2026-08-20");
  assert.equal(window.start.toISOString(), "2026-08-20T03:00:00.000Z");
  assert.equal(window.end.toISOString(), "2026-08-21T03:00:00.000Z");
});
