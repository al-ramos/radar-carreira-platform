import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("MCP do Radar expõe apenas ferramentas da fila privada do Codex", async () => {
  const [worker, packageJson] = await Promise.all([
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(worker, /WebStandardStreamableHTTPServerTransport/);
  assert.match(worker, /RADAR_CODEX_MCP_TOKEN/);
  assert.match(worker, /\/mcp\/radar/);
  assert.match(worker, /listar_analises_pendentes/);
  assert.match(worker, /abrir_analise_preparada/);
  assert.match(worker, /concluir_analise_preparada/);
  assert.match(worker, /Triagem pelo Codex concluída/);
  assert.match(worker, /INSERT INTO notifications/);
  assert.match(worker, /reviewId/);
  assert.doesNotMatch(worker, /registerTool\("executar_sql/);
  assert.match(packageJson, /@modelcontextprotocol\/sdk/);
});
