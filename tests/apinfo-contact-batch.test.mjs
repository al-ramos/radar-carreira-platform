import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("captura em lote salva usando um snapshot fixo, não o estado 'items' ao vivo", async () => {
  const dashboard = await readFile(new URL("../app/Dashboard.tsx", import.meta.url), "utf8");

  // Bug real reportado em 17/08/2026 ("intermitência ao guardar o email"):
  // o handler de PROGRESS buscava a vaga em itemsRef.current.find(...), que
  // reflete o estado "items" ao vivo — substituído por inteiro durante o
  // lote (minutos de duração) por refresh de visibilitychange, paginação,
  // etc. Uma vaga que saísse de "items" nesse meio tempo tinha o e-mail já
  // capturado descartado sem aviso, sem erro visível. Corrigido com um
  // snapshot fixo (contactBatchJobsRef), montado uma única vez quando o
  // lote começa — ver claude/radar-carreira-apinfo-captura-email-lote.md
  // no projeto RADAR CARREIRA.
  assert.match(dashboard, /contactBatchJobsRef = useRef<Map<string, Job>>\(new Map\(\)\)/);
  assert.match(dashboard, /contactBatchJobsRef\.current = new Map\(pending\.map/);
  assert.match(dashboard, /contactBatchJobsRef\.current\.get\(String\(last\.externalId\)\)/);
});

test("falha ao salvar (depois de já ter sido capturado) fica contabilizada, não só a falha de captura", async () => {
  const dashboard = await readFile(new URL("../app/Dashboard.tsx", import.meta.url), "utf8");

  assert.match(dashboard, /contactBatchSaveFailedRef = useRef\(0\)/);
  assert.match(dashboard, /contactBatchSaveFailedRef\.current \+= 1/);
  assert.match(dashboard, /encontrado.*mas não salvo.*no Radar/);
});
