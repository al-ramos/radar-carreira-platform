export type TriageImportRow = { line: number; externalId: string; verdict: "✅" | "🟡" | "🔴" | "❌"; description: string };
export type TriageImportResult = { rows: TriageImportRow[]; rejected: Array<{ line: number; reason: string }> };

const STATUS_ALIASES: Record<string, TriageImportRow["verdict"]> = {
  "✅": "✅", "aprovada": "✅", "aprovado": "✅",
  "🟡": "🟡", "provável": "🟡", "provavel": "🟡", "provável com ressalvas": "🟡", "provavel com ressalvas": "🟡",
  "🔴": "🔴", "não bate": "🔴", "nao bate": "🔴", "reprovada": "🔴",
  "❌": "❌", "bloqueador": "❌", "bloqueador estrutural": "❌", "bloqueada": "❌", "bloqueado": "❌",
};

const HEADER_ALIASES: Record<string, "externalId" | "verdict" | "description"> = {
  codigo: "externalId", "código": "externalId", externalid: "externalId", "código externo": "externalId", "codigo externo": "externalId",
  status: "verdict", veredito: "verdict",
  descricao: "description", "descrição": "description", motivo: "description", label: "description",
};

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeStatus(value: string): TriageImportRow["verdict"] | null {
  const trimmed = value.trim();
  return STATUS_ALIASES[trimmed] ?? STATUS_ALIASES[trimmed.toLowerCase()] ?? null;
}

/** Tokenizador simples de CSV: aceita `,` ou `;`, campos entre aspas e quebras CRLF/LF. */
function tokenizeRows(input: string, delimiter: string): string[][] {
  const output: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') { if (quoted && input[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (c === delimiter && !quoted) { row.push(field.trim()); field = ""; }
    else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && input[i + 1] === "\n") i++;
      row.push(field.trim());
      if (row.some(Boolean)) output.push(row);
      row = []; field = "";
    } else field += c;
  }
  row.push(field.trim());
  if (row.some(Boolean)) output.push(row);
  return output;
}

/**
 * Lê o CSV de análise (código, status, descrição) que alimenta uma leitura
 * externa de volta para o Radar. Linhas com código ausente, status
 * não reconhecido ou vazias são rejeitadas com o motivo, não silenciosamente
 * descartadas.
 */
export function parseCsvTriageImport(input: string): TriageImportResult {
  const clean = input.replace(/^﻿/, "").trim();
  if (!clean) return { rows: [], rejected: [] };
  const firstLine = clean.split(/\r?\n/, 1)[0];
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const table = tokenizeRows(clean, delimiter);
  if (table.length < 2) return { rows: [], rejected: [] };

  const headerMap = table[0].map((header) => HEADER_ALIASES[normalizeHeader(header)] ?? null);
  const rows: TriageImportRow[] = [];
  const rejected: Array<{ line: number; reason: string }> = [];

  table.slice(1, 2001).forEach((columns, index) => {
    const line = index + 2; // +1 pelo header, +1 porque a linha 1 é humana
    const record: Partial<Record<"externalId" | "verdict" | "description", string>> = {};
    headerMap.forEach((key, colIndex) => { if (key) record[key] = columns[colIndex]?.trim() ?? ""; });
    const externalId = record.externalId?.trim();
    if (!externalId) { rejected.push({ line, reason: "código ausente" }); return; }
    const verdict = record.verdict ? normalizeStatus(record.verdict) : null;
    if (!verdict) { rejected.push({ line, reason: `status "${record.verdict ?? ""}" não reconhecido` }); return; }
    rows.push({ line, externalId, verdict, description: record.description?.trim() ?? "" });
  });

  return { rows, rejected };
}
