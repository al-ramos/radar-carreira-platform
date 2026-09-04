import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

// A listagem respondia 503 em produção com "(intermediate value) is not
// iterable". filterOptionsQueries() devolve UMA promessa de array; espalhá-la
// com ... tenta iterar a promessa, que não é iterável.
test("espalhar uma promessa de array é um TypeError, não uma espera", () => {
  const promessaDeArray = Promise.all([Promise.resolve("a"), Promise.resolve("b")]);
  assert.throws(() => [0, ...promessaDeArray], TypeError);
});

test("a listagem não espalha a promessa das consultas de filtro", async () => {
  const route = await read("../app/api/jobs/route.ts");
  assert.doesNotMatch(route, /\.\.\.\(metadataMode === "full" \? filterOptionsQueries\(\) : \[\]\)/);
  // O resto é destructuring posicional, não rest: metadataRows recebe a lista
  // já resolvida, e só então é espalhada para serializeFilterOptions.
  assert.doesNotMatch(route, /summaryTotals, \.\.\.metadataRows/);
  assert.match(route, /metadataMode === "full" \? filterOptionsQueries\(\) : Promise\.resolve\(null\)/);
  assert.match(route, /const \[rows, summaryTotals, metadataRows\] = await Promise\.all\(\[/);
  assert.match(route, /metadataRows \? serializeFilterOptions\(\.\.\.metadataRows\) : undefined/);
});

// "full" é o modo padrão: vale para toda chamada sem o parâmetro `meta`,
// inclusive a que abre uma vaga específica pelo link.
test("o modo completo continua sendo o padrão da rota", async () => {
  const route = await read("../app/api/jobs/route.ts");
  assert.match(route, /url\.searchParams\.get\("meta"\) === "none" \? "none" : "full"/);
});
