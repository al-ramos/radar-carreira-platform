import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("a Triagem exibe e filtra candidatura ou envio com a data correspondente", async () => {
  const [screen, history] = await Promise.all([
    read("../app/TriageReport.tsx"),
    read("../app/api/triage/history/route.ts"),
  ]);

  assert.match(screen, /Filtrar descrição/);
  assert.match(screen, /Candidatura \/ envio/);
  assert.match(screen, /Candidatura LinkedIn/);
  assert.match(screen, /E-mail APInfo/);
  assert.match(screen, /applicationActivityAt/);
  assert.match(screen, /sortHistory\("description"\)/);
  assert.match(screen, /sortHistory\("applicationActivityAt"\)/);
  assert.match(history, /userJobStatus\.applicationStatus/);
  assert.match(history, /applicationGeneratedAt: userJobStatus\.generatedAt/);
  assert.match(history, /applicationSentAt: userJobStatus\.sentAt/);
  assert.match(history, /applicationRespondedAt: userJobStatus\.respondedAt/);
});
