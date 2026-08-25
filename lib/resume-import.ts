import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { SKILL_OPTIONS } from "./profile-options.ts";

export type ResumeSkillSuggestion = {
  name: string;
  confidence: number;
  evidence: string;
};

export type ResumeProposal = {
  skills: ResumeSkillSuggestion[];
  coreStackCandidates: string[];
  source: "ai" | "local";
  pageCount: number;
  textCharacters: number;
};

const MAX_PAGES = 30;
const MAX_TEXT_CHARACTERS = 50_000;

const aliases: Array<{ canonical: string; values: string[] }> = [
  { canonical: "Visual Basic 6", values: ["visual basic 6", "visual basic 6.0", "vb6", "vb 6"] },
  { canonical: "VBA", values: ["vba", "visual basic for applications"] },
  { canonical: ".NET", values: [".net", ".net framework", ".net core", "dotnet"] },
  { canonical: "C#", values: ["c#", "c sharp", "csharp"] },
  { canonical: "ASP.NET", values: ["asp.net", "asp net"] },
  { canonical: "SQL Server", values: ["sql server", "microsoft sql server", "mssql"] },
  { canonical: "GitHub Actions", values: ["github actions", "github action"] },
  { canonical: "Power BI", values: ["power bi", "powerbi"] },
];

function normalized(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchPosition(text: string, term: string) {
  return text.search(new RegExp(`(^|[^a-z0-9+#.])${escapeRegExp(term)}(?=$|[^a-z0-9+#])`, "i"));
}

function evidenceAround(text: string, position: number) {
  return text.slice(Math.max(0, position - 90), Math.min(text.length, position + 180)).replace(/\s+/g, " ").trim().slice(0, 260);
}

/**
 * O PDF não é persistido: esta função recebe apenas os bytes da requisição,
 * limita páginas/texto e devolve conteúdo suficiente para análise transitória.
 */
export async function extractTextFromPdf(bytes: ArrayBuffer): Promise<{ text: string; pageCount: number }> {
  const data = new Uint8Array(bytes);
  const signature = new TextDecoder().decode(data.slice(0, 5));
  if (signature !== "%PDF-") throw new Error("O arquivo não é um PDF válido.");
  const loadingTask = getDocument({ data, disableWorker: true, stopAtErrors: true });
  try {
    const document = await loadingTask.promise;
    if (document.numPages > MAX_PAGES) throw new Error(`O currículo tem ${document.numPages} páginas; o limite é ${MAX_PAGES}.`);
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items.flatMap((item) => "str" in item && typeof item.str === "string" ? [item.str] : []).join(" ");
      pages.push(`[Página ${pageNumber}] ${pageText}`);
      if (pages.join("\n").length > MAX_TEXT_CHARACTERS) throw new Error("O texto do currículo excede o limite permitido.");
    }
    const text = pages.join("\n").replace(/\s+/g, " ").trim();
    if (text.length < 80) throw new Error("Não foi possível ler texto suficiente deste PDF. Envie um PDF com texto selecionável; OCR para documentos escaneados será incluído em seguida.");
    return { text, pageCount: document.numPages };
  } finally {
    await loadingTask.destroy();
  }
}

/** Remove contatos que não ajudam a identificar competências antes do envio à IA. */
export function redactResumeContacts(text: string) {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[e-mail removido]")
    .replace(/(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?9?\d{4}[-\s]?\d{4}/g, "[telefone removido]")
    .replace(/\b\d{3}\.\d{3}\.\d{3}-?\d{2}\b/g, "[documento removido]");
}

/** Fallback local: útil se a IA não estiver configurada e como barreira contra sugestões inventadas. */
export function extractKnownSkills(text: string): ResumeSkillSuggestion[] {
  const source = normalized(text);
  const candidates = new Map<string, number>();
  for (const skill of SKILL_OPTIONS) candidates.set(skill, matchPosition(source, normalized(skill)));
  for (const alias of aliases) {
    const position = Math.min(...alias.values.map((value) => matchPosition(source, normalized(value))).filter((position) => position >= 0));
    if (Number.isFinite(position)) candidates.set(alias.canonical, position);
  }
  return [...candidates.entries()]
    .filter(([, position]) => position >= 0)
    .sort(([, left], [, right]) => left - right)
    .slice(0, 80)
    .map(([name, position]) => ({ name, confidence: 0.8, evidence: evidenceAround(text, position) }));
}

export function normalizeResumeSkill(value: unknown) {
  const candidate = typeof value === "string" ? value.trim().slice(0, 100) : "";
  if (!candidate) return "";
  const comparable = normalized(candidate);
  const alias = aliases.find((item) => item.values.some((value) => normalized(value) === comparable));
  if (alias) return alias.canonical;
  return SKILL_OPTIONS.find((skill) => normalized(skill) === comparable) ?? candidate;
}
