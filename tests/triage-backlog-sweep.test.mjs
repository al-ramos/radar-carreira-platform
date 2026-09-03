import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

/**
 * A triagem agendada por fonte só é disparada por uma coleta ou importação
 * bem-sucedida daquela fonte. Isso cobre vaga nova, mas não cobre invalidação:
 * quando o perfil canônico ou a revisão das regras muda, toda vaga ativa já
 * coletada passa a precisar de triagem nova e nenhuma importação volta a
 * acontecer para as fontes que pararam de produzir. Sem varredura, o veredito
 * oficial dessas vagas congela em uma revisão antiga.
 */
test("o backlog de triagem invalidada é varrido pela rotina agendada", async () => {
  const [worker, run, currentTriage] = await Promise.all([
    read("../worker/index.ts"), read("../app/api/triage/run/route.ts"), read("../lib/current-triage.ts"),
  ]);

  assert.match(worker, /async function dispatchTriageBacklogSweep\(env: Env\)/);
  // A varredura é um parâmetro operacional, não uma decisão do Worker.
  assert.match(worker, /dispatchTriageBacklogSweep[\s\S]*scheduled_triage_enabled AS enabled/);
  assert.match(worker, /dispatchTriageBacklogSweep[\s\S]*if \(!settings\?\.enabled\) return;/);
  // Sem sourceId a rota varre todas as fontes; homePeriod "all" tira o recorte
  // do dia civil que prende a agenda às vagas coletadas hoje.
  assert.match(worker, /dispatchTriageBacklogSweep[\s\S]*run: \{ dateScope: "received", homePeriod: "all", aiMode: "off"/);
  // Recompor o veredito determinístico é o que restaura a consistência; o
  // backlog pode ter milhares de vagas e não deve consumir IA paga.
  assert.doesNotMatch(worker, /dispatchTriageBacklogSweep[\s\S]{0,600}aiMode: "ambiguous"/);
  // Um tique por hora: o cron dispara a cada 15 minutos.
  assert.match(worker, /sweepMinute >= 30 && sweepMinute < 45/);
  assert.match(worker, /ctx\.waitUntil\(dispatchTriageBacklogSweep\(env\)/);
  assert.match(worker, /triage-backlog-sweep/);
  // A varredura entra pelo mesmo caminho que reserva orçamento de fila.
  assert.match(worker, /dispatchTriageBacklogSweep[\s\S]*await dispatchScheduledTriage\(env, \[\{/);
  // sourceId opcional é o que distingue a varredura global do disparo por fonte.
  assert.match(worker, /run: \{ sourceId\?: string; dateScope: "received"/);

  // A seleção precisa reagir à invalidação por revisão, não só à ausência de
  // análise: é isso que recoloca na fila a vaga triada com o perfil anterior.
  assert.match(run, /run\.reprocess \? undefined : needsCurrentTriage\(userId, versions\)/);
  assert.match(currentTriage, /triageHistory\.profileRevision.*versions\.profileRevision/s);
  // homePeriod desliga o recorte do dia civil.
  assert.match(run, /const usesHomePeriod = Boolean\(run\.homePeriod\);/);
  assert.match(run, /const scopedToReferenceDay = !usesHomePeriod &&/);
  // O lote da varredura é distinguível na auditoria.
  assert.match(run, /run\.homePeriod === "all" \? "schedule-backlog" : "schedule-day"/);
  // A continuação encadeada é o que drena um backlog maior que o lote.
  assert.match(run, /hasMore: run\.trigger === "schedule" && candidates\.length === run\.batchSize/);
  assert.match(worker, /result\?\.hasMore === true/);
});
