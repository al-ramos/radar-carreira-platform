import assert from "node:assert/strict";
import test from "node:test";
import { buildMarketIntelligence } from "../lib/market-intelligence.ts";

const job = (overrides = {}) => ({
  id: crypto.randomUUID(), company: "Empresa", location: "São Paulo", workMode: "Remoto", stack: '["TypeScript", "React"]',
  status: "active", roleArea: "frontend", sourceId: "linkedin-extension", sourceName: "Extensão LinkedIn",
  publishedAt: null, sourcePublishedAt: null, firstSeenAt: "2026-08-28T12:00:00.000Z", description: "Descrição completa de uma oportunidade de tecnologia.",
  ...overrides,
});

test("consolida as métricas de mercado somente para o recorte selecionado", () => {
  const report = buildMarketIntelligence([
    job(),
    job({ id: "outra-fonte", sourceId: "email", sourceName: "Gmail", roleArea: "backend", stack: '[".NET"]' }),
    job({ id: "vaga-fechada", status: "closed", location: null, stack: "[]" }),
  ], { period: "30", source: "linkedin-extension", area: "all" }, { now: new Date("2026-09-01T12:00:00.000Z") });

  assert.equal(report.summary.total, 2);
  assert.equal(report.summary.active, 1);
  assert.equal(report.summary.companies, 1);
  assert.equal(report.breakdowns.skills[0].label, "React");
  assert.equal(report.breakdowns.locations[0].label, "São Paulo");
  assert.equal(report.sourceOptions.length, 2);
});

test("explica ausência de vagas sem inventar previsão", () => {
  const report = buildMarketIntelligence([], { period: "7", source: "all", area: "security" }, { now: new Date("2026-09-01T12:00:00.000Z") });
  assert.equal(report.summary.total, 0);
  assert.match(report.insights[0], /Não há vagas/);
  assert.equal(report.dataAvailability.salary, false);
});

test("permite filtrar vagas sem origem identificada", () => {
  const report = buildMarketIntelligence(
    [
      job({ id: "manual", sourceId: null, sourceName: null }),
      job({ id: "linkedin", sourceId: "linkedin", sourceName: "LinkedIn" }),
    ],
    { period: "all", source: "unidentified", area: "all" },
    { now: new Date("2026-09-01T12:00:00.000Z") },
  );

  assert.equal(report.summary.total, 1);
  assert.equal(report.sourceOptions.find(source => source.id === "unidentified")?.label, "Importação manual");
});
