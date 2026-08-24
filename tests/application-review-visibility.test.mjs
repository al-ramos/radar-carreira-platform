import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("rascunhos e candidaturas enviadas ficam ocultos por padrão na fila de análise", async () => {
  const [dashboard, jobsRoute] = await Promise.all([
    read("../app/Dashboard.tsx"),
    read("../app/api/jobs/route.ts"),
  ]);

  assert.match(dashboard, /useState<ReviewVisibility>\("pending"\)/);
  assert.match(dashboard, /params\.set\("reviewVisibility", reviewVisibility\)/);
  assert.match(jobsRoute, /reviewVisibility.*=== "all" \? "all" : "pending"/);
  assert.match(jobsRoute, /item\.applicationStatus === "generated" \|\| item\.applicationStatus === "sent" \|\| item\.applicationStatus === "responded"/);
  assert.match(jobsRoute, /notInArray\(jobs\.id, applicationIds\)/);
});

test("tabela informa a situação da candidatura", async () => {
  const dashboard = await read("../app/Dashboard.tsx");
  assert.match(dashboard, /label: "Situação"/);
  assert.match(dashboard, /Rascunho/);
  assert.match(dashboard, /E-mail enviado/);
  assert.match(dashboard, /Resposta recebida/);
});
