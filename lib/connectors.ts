import type { ImportedJob } from "./jobs";
type Provider="greenhouse"|"lever"|"ashby";
type GreenhouseJob={id:string|number;title:string;updated_at?:string;absolute_url:string;content?:string;location?:{name?:string}};
type LeverJob={id:string;text:string;hostedUrl:string;descriptionPlain?:string;description?:string;workplaceType?:string;categories?:{location?:string}};
type AshbyJob={id?:string;title:string;location?:string;isRemote?:boolean;publishedAt?:string;jobUrl?:string;applyUrl?:string;descriptionPlain?:string;descriptionHtml?:string};
const safe=(value:string)=>{if(!/^[a-zA-Z0-9_-]+$/.test(value))throw new Error("Identificador da fonte inválido");return value};
const clean=(html:string="")=>html.replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/\s+/g," ").trim();
const mode=(text:string)=>/remote|remoto/i.test(text)?"Remoto":/hybrid|híbrido|hibrido/i.test(text)?"Híbrido":"Presencial";
export async function collect(provider:Provider,externalRef:string,company:string):Promise<ImportedJob[]>{
 const ref=safe(externalRef);
 if(provider==="greenhouse"){const r=await fetch(`https://boards-api.greenhouse.io/v1/boards/${ref}/jobs?content=true`);if(!r.ok)throw new Error(`Greenhouse respondeu ${r.status}`);const data=await r.json() as {jobs?:GreenhouseJob[]};return (data.jobs??[]).map(j=>({externalId:String(j.id),company,title:j.title,location:j.location?.name??"",workMode:mode(j.location?.name??""),publishedAt:j.updated_at,url:j.absolute_url,description:clean(j.content),stack:[]}))}
 if(provider==="lever"){const r=await fetch(`https://api.lever.co/v0/postings/${ref}?mode=json`);if(!r.ok)throw new Error(`Lever respondeu ${r.status}`);const data=await r.json() as LeverJob[];return data.map(j=>({externalId:j.id,company,title:j.text,location:j.categories?.location??"",workMode:mode(`${j.categories?.location??""} ${j.workplaceType??""}`),url:j.hostedUrl,description:clean(j.descriptionPlain??j.description),stack:[]}))}
 const r=await fetch(`https://api.ashbyhq.com/posting-api/job-board/${ref}`);if(!r.ok)throw new Error(`Ashby respondeu ${r.status}`);const data=await r.json() as {jobs?:AshbyJob[]};return (data.jobs??[]).map(j=>({externalId:j.id??j.jobUrl,company,title:j.title,location:j.location??"",workMode:j.isRemote?"Remoto":mode(j.location??""),publishedAt:j.publishedAt,url:j.jobUrl??j.applyUrl??"",description:clean(j.descriptionPlain??j.descriptionHtml),stack:[]}));
}
