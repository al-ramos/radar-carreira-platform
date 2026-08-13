// applyUrl é o link "vivo" de candidatura (pode carregar token de sessão e
// expirar) — propositalmente fora do fingerprint, que usa apenas `url` (o
// identificador estável da vaga). Fontes cujo link de referência não abre a
// vaga diretamente (ex.: APinfo, cuja URL estável é uma busca por código)
// devem preencher applyUrl com o link que realmente abre a vaga/candidatura.
// contactEmail/contactSubject podem vir de qualquer canal de ingestão ou de
// uma captura posterior do usuário. Ficam fora do fingerprint para reenviar a
// mesma vaga com o contato preenchido depois apenas atualizar a linha
// existente, sem duplicar.
export type ImportedJob={externalId?:string;company:string;title:string;seniority?:string;workMode?:string;location?:string;stack?:string[];publishedAt?:string;url:string;applyUrl?:string;contactEmail?:string;contactSubject?:string;description?:string;sourceId?:string};

/** Normaliza o e-mail para a interface sem inferir nada sobre sua origem. */
export function normalizeContactEmail(value: unknown): string | undefined {
 return typeof value === "string" ? value.trim() || undefined : undefined;
}

/** Converte apenas datas realmente informadas pela fonte. Aceita ISO e o
 * formato dd/mm/aa usado pelo APInfo; valor ausente ou inválido permanece
 * nulo para não ser confundido com o horário da coleta. */
export function sourcePublishedJobDate(value: string | undefined): Date | null {
 const text = value?.trim();
 if (!text) return null;
 const br = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
 if (br) {
  const year = Number(br[3]) < 100 ? 2000 + Number(br[3]) : Number(br[3]);
  const month = Number(br[2]) - 1;
  const day = Number(br[1]);
  const hour = Number(br[4] ?? 12);
  const minute = Number(br[5] ?? 0);
  const parsed = new Date(year, month, day, hour, minute);
  return parsed.getFullYear() === year && parsed.getMonth() === month && parsed.getDate() === day && parsed.getHours() === hour && parsed.getMinutes() === minute
   ? parsed
   : null;
 }
 const parsed = new Date(text);
 return Number.isFinite(parsed.getTime()) ? parsed : null;
}

/** Toda vaga precisa ter uma data para ordenação, filtros e exibição.
 * Quando a fonte não informa publicação, usa-se o momento da coleta. */
export function recordedJobDate(value: string | undefined, fallback: Date): Date {
 return sourcePublishedJobDate(value) ?? fallback;
}

export function normalize(value:string){return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim()}
export function fingerprint(job:ImportedJob){const input=[job.company,job.title,job.location??"",job.url].map(normalize).join("|");let hash=2166136261;for(let i=0;i<input.length;i++){hash^=input.charCodeAt(i);hash=Math.imul(hash,16777619)}return (hash>>>0).toString(16).padStart(8,"0")}
export function validJob(value:unknown):value is ImportedJob{if(!value||typeof value!=="object")return false;const job=value as Record<string,unknown>;return ["company","title","url"].every(k=>typeof job[k]==="string"&&String(job[k]).trim().length>0)}
