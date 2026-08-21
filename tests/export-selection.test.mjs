import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("tabela permite selecionar vagas e a exportação prioriza a seleção", async () => {
  const [dashboard, css] = await Promise.all([
    readFile(new URL("../app/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/radar-refinement.css", import.meta.url), "utf8"),
  ]);
  assert.match(dashboard, /const \[exportSelectionIds, setExportSelectionIds\]/);
  assert.match(dashboard, /toggleVisibleTableJobsForExport/);
  assert.match(dashboard, /scope: "page" \| "all" \| "selected"/);
  assert.match(dashboard, /scope === "selected" \? selectedJobsForExport/);
  assert.match(dashboard, /Exportar selecionadas/);
  assert.match(dashboard, /Nenhuma vaga marcada: exporta todas conforme os filtros/);
  assert.match(dashboard, /Selecionar \$\{j\.title\} da empresa \$\{j\.company\} para exportação/);
  assert.match(css, /job-table-selection/);
});
