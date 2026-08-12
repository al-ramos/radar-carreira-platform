// applyUrl é o link "vivo" de candidatura (pode carregar token de sessão e
// expirar) — propositalmente fora do fingerprint, que usa apenas `url` (o
// identificador estável da vaga). Fontes cujo link de referência não abre a
// vaga diretamente (ex.: APinfo, cuja URL estável é uma busca por código)
// devem preencher applyUrl com o link que realmente abre a vaga/candidatura.
// contactEmail/contactSubject vêm de uma captura manual do usuário (ex.: a
// tela pós-login do APinfo que revela o e-mail do recrutador) — também fora
// do fingerprint, para reenviar a mesma vaga com o contato preenchido depois
// apenas atualizar a linha existente, sem duplicar.
export type ImportedJob={externalId?:string;company:string;title:string;seniority?:string;workMode?:string;location?:string;stack?:string[];publishedAt?:string;url:string;applyUrl?:string;contactEmail?:string;contactSubject?:string;description?:string;sourceId?:string};

/** Toda vaga precisa ter uma data para ordenação, filtros e exibição.
 * Quando a fonte não informa publicação, usa-se o momento da coleta. */
export function recordedJobDate(value: string | undefined, fallback: Date): Date {
 const parsed = value ? new Date(value) : null;
 return parsed && Number.isFinite(parsed.getTime()) ? parsed : fallback;
}

export function normalize(value:string){return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim()}
export function fingerprint(job:ImportedJob){const input=[job.company,job.title,job.location??"",job.url].map(normalize).join("|");let hash=2166136261;for(let i=0;i<input.length;i++){hash^=input.charCodeAt(i);hash=Math.imul(hash,16777619)}return (hash>>>0).toString(16).padStart(8,"0")}
export function validJob(value:unknown):value is ImportedJob{if(!value||typeof value!=="object")return false;const job=value as Record<string,unknown>;return ["company","title","url"].every(k=>typeof job[k]==="string"&&String(job[k]).trim().length>0)}
