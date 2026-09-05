import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

// A tela "Vagas afetadas" só mostrava o log da importação, sem ação nenhuma
// sobre as vagas listadas — quem quisesse triar ou desclassificar uma delas
// precisava sair do relatório e encontrá-la de novo em outro lugar.
test("o relatório de importação permite selecionar vagas e agir sobre elas", async () => {
  const component = await read("../app/ImportRunReport.tsx");
  assert.match(component, /const \[selected, setSelected\] = useState<Set<string>>/);
  assert.match(component, /function toggleAllVisible\(\)/);
  assert.match(component, /aria-label=\{`Selecionar \$\{job\.title\}`\}/);
  assert.match(component, /fetch\("\/api\/triage\/disqualify", \{/);
  assert.match(component, /fetch\("\/api\/triage\/queue", \{/);
  // As duas ações nunca disparam e-mail, candidatura ou qualquer coisa
  // irreversível — só desclassificam ou colocam na fila de regras. Não há
  // chamada a nenhuma rota de rascunho/candidatura nesta tela.
  assert.doesNotMatch(component, /fetch\(["'`]\/api\/(triage\/drafts|collector\/import)/);
  assert.equal((component.match(/fetch\(/g) || []).length, 3);
});

test("uma vaga tratada na sessão some da seleção, não da lista", async () => {
  const component = await read("../app/ImportRunReport.tsx");
  assert.match(component, /const \[handledJobIds, setHandledJobIds\] = useState<Set<string>>/);
  assert.match(component, /const selectableJobs = filteredJobs\.filter\(job => !handledJobIds\.has\(job\.id\)\)/);
  assert.match(component, /Tratada nesta sessão/);
});

// Desclassificar exigia uma avaliação já existente (409 caso contrário) — o
// que impedia desclassificar uma vaga recém-importada, exatamente o caso de
// uso desta tela.
test("desclassificar funciona mesmo para uma vaga sem avaliação prévia", async () => {
  const route = await read("../app/api/triage/disqualify/route.ts");
  assert.doesNotMatch(route, /Uma ou mais vagas ainda não possuem avaliação para desclassificar/);
  assert.match(route, /jobIdsWithoutAnalysis/);
  assert.match(route, /onConflictDoUpdate\(\{/);
  // Vaga já avaliada continua preservando a revisão e o "rows" originais.
  assert.match(route, /rows: analysis\.rows/);
});

// A fila de triagem só aceitava um filtro (fonte/período/etc.) e escolhia os
// candidatos sozinha; não havia como dizer "estas vagas específicas, agora".
test("a fila de triagem aceita uma seleção explícita de jobIds", async () => {
  const route = await read("../app/api/triage/queue/route.ts");
  assert.match(route, /const explicitJobIds = Array\.isArray\(body\.jobIds\)/);
  assert.match(route, /const MAX_SELECTION_TRIAGE_JOBS = 200/);
  assert.match(route, /reprocess: explicitJobIds \? true : body\.reprocess/);
  assert.match(route, /"Uma ou mais vagas não foram encontradas\."/);
  // A seleção explícita reaproveita o mesmo caminho de fila, cota e
  // criação de lote que o filtro por fonte/período já usava.
  assert.match(route, /candidates = found;/);
  assert.match(route, /reserveQueueMessages\(db, "radar-carreira-triage-manual", payloads\.length/);
});
