import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTriageRunRequest } from "../lib/triage-orchestrator.ts";

test("todos os acionadores usam o mesmo contrato e padrão de São Paulo", () => {
  const now = new Date("2026-08-20T02:30:00.000Z");
  for (const trigger of ["portal", "schedule", "gpt"]) {
    assert.deepEqual(normalizeTriageRunRequest({ trigger }, now), {
      trigger, referenceDate: "2026-08-19", batchSize: 10, reprocess: false, aiMode: "ambiguous", createDrafts: false,
    });
  }
});

test("normaliza parâmetros de execução e limita o lote", () => {
  assert.deepEqual(normalizeTriageRunRequest({ trigger: "portal", referenceDate: "2026-08-20", batchSize: 999, reprocess: true, aiMode: "off", createDrafts: true }), {
    trigger: "portal", referenceDate: "2026-08-20", batchSize: 100, reprocess: true, aiMode: "off", createDrafts: true,
  });
});
