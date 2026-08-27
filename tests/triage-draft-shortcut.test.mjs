import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const screen = await readFile(new URL("../app/TriageReport.tsx", import.meta.url), "utf8");

const openHistory = screen.match(/const openHistory = \(nextDraftFilter = "all"\) => \{([\s\S]*?)\n  \};/);
assert.ok(openHistory, "mantém o atalho operacional do histórico");
assert.match(openHistory[1], /setDraftFilter\(nextDraftFilter\);/);
assert.match(openHistory[1], /setOutreachFilter\("all"\);/, "atalhos de rascunho limpam o filtro incompatível de envio/candidatura");
assert.match(screen, /openHistory\("drafted"\)/, "o atalho de rascunhos prontos continua usando o histórico");
