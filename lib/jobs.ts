export type ImportedJob={externalId?:string;company:string;title:string;seniority?:string;workMode?:string;location?:string;stack?:string[];publishedAt?:string;url:string;description?:string;sourceId?:string};

export function normalize(value:string){return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim()}
export function fingerprint(job:ImportedJob){const input=[job.company,job.title,job.location??"",job.url].map(normalize).join("|");let hash=2166136261;for(let i=0;i<input.length;i++){hash^=input.charCodeAt(i);hash=Math.imul(hash,16777619)}return (hash>>>0).toString(16).padStart(8,"0")}
export function validJob(value:unknown):value is ImportedJob{if(!value||typeof value!=="object")return false;const job=value as Record<string,unknown>;return ["company","title","url"].every(k=>typeof job[k]==="string"&&String(job[k]).trim().length>0)}
