import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const database = "radar-carreira-db";
const query = `
WITH queued AS (
  SELECT json_extract(item.value, '$.id') AS job_id
  FROM triage_ai_reviews review, json_each(review.selection, '$.jobs') item
  WHERE review.id IN (
    '509159ee-653e-49a6-bb47-28c2bb37e313',
    '8d3cfedf-04d4-4d2a-9fbf-4463ae5e59f9',
    'dd8e40ac-4ee0-4ea6-a7db-1f30e98d3a79',
    '92b80777-a524-4418-8a9f-e06cd3a72b41',
    'f7f5a7a2-c020-430d-8c01-fb2477ee6f0b'
  )
)
SELECT jobs.external_id AS codigo, jobs.title, jobs.description, coalesce(jobs.stack, '') AS stack
FROM queued
JOIN jobs ON jobs.id = queued.job_id
ORDER BY CAST(jobs.external_id AS INTEGER), jobs.id`;

const raw = execFileSync(
  "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  ["-NoProfile", "-Command", `npx.cmd wrangler d1 execute ${database} --remote --json --command \"${query.replace(/\s+/g, " ").trim()}\"`],
  { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
);
const jsonStart = raw.indexOf("[\n  {");
if (jsonStart < 0) throw new Error("A consulta ao D1 não retornou JSON.");
const payload = JSON.parse(raw.slice(jsonStart));
const rows = payload[0]?.results ?? [];
if (!rows.length) throw new Error("Nenhuma vaga pendente na fila do Codex.");

const core = [
  ["c#", "C#"], ["csharp", "C#"], [".net", ".NET"], ["dot.net", ".NET"],
  ["vb.net", "VB.NET"], ["vb6", "VB6"], ["visual basic", "Visual Basic"],
  ["sql server", "SQL Server"], ["postgresql", "PostgreSQL"], ["mysql", "MySQL"],
  ["oracle", "Oracle"], ["sqlite", "SQLite"],
];
const adjacent = ["back-end", "backend", "desenvolvedor", "desenvolvimento", "programador", "engenheiro de software", "banco de dados", "database"];

function classify(row) {
  const text = `${row.title} ${row.description} ${row.stack}`.toLocaleLowerCase("pt-BR");
  if (text.includes("inglês") || text.includes("espanhol")) {
    return ["❌", "Bloqueada: a descrição exige idioma em avoidTerms (inglês/espanhol)."];
  }
  const match = core.find(([term]) => text.includes(term));
  if (match) return ["✅", `Forte aderência: há evidência de ${match[1]}, parte da sua stack dominada.`];
  if (adjacent.some((term) => text.includes(term))) {
    return ["🟡", "Aderência parcial: área técnica próxima, mas sem evidência clara da sua stack dominada."];
  }
  return ["🔴", "Aderência fraca: não há evidência de .NET, C#, VB ou bancos de dados da sua stack."];
}

const csvCell = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const outputRows = rows.map((row) => {
  const [status, descricao] = classify(row);
  return { codigo: row.codigo, titulo: row.title, status, descricao };
});
const csv = [
  "código;título;status;descrição",
  ...outputRows.map((row) => [row.codigo, row.titulo, row.status, row.descricao].map(csvCell).join(";")),
].join("\r\n") + "\r\n";

const outputDir = path.resolve("exports");
await fs.mkdir(outputDir, { recursive: true });
const outputPath = path.join(outputDir, "analise-externa-codex-titulo-em-coluna-2026-08-24.csv");
await fs.writeFile(outputPath, csv, "utf8");
const totals = Object.fromEntries(["✅", "🟡", "🔴", "❌"].map((status) => [status, outputRows.filter((row) => row.status === status).length]));
console.log(JSON.stringify({ outputPath, total: outputRows.length, totals }));
