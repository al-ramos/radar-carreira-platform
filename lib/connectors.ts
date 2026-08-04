import type { ImportedJob } from "./jobs";
type Provider="greenhouse"|"lever"|"ashby";
const safe=(value:string)=>{if(!/^[a-zA-Z0-9_-]+$/.test(value))throw new Error("Identificador da fonte inválido");return value};
const clean=(html:string="")=>html.replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/\s+/g," ").trim();
const mode=(text:string)=>/remote|remoto/i.test(text)?"Remoto":/hybrid|híbrido|hibrido/i.test(text)?"Híbrido":"Presencial";
export async function collect(provider:Provider,externalRef:string,company:string):Promise<ImportedJob[]>{
 const ref=safe(externalRef);
 if(provider==="greenhouse"){const r=await fetch(`https://boards-api.greenhouse.io/v1/boards/${ref}/jobs?content=true`);if(!r.ok)throw new Error(`Greenhouse respondeu ${r.status}`);const data=await r.json() as any;return (data.jobs??[]).map((j:any)=>({externalId:String(j.id),company,title:j.title,location:j.location?.name??"",workMode:mode(j.location?.name??""),publishedAt:j.updated_at,url:j.absolute_url,description:clean(j.content),stack:[]}))}
 if(provider==="lever"){const r=await fetch(`https://api.lever.co/v0/postings/${ref}?mode=json`);if(!r.ok)throw new Error(`Lever respondeu ${r.status}`);const data=await r.json() as any[];return data.map((j:any)=>({externalId:j.id,company,title:j.text,location:j.categories?.location??"",workMode:mode(`${j.categories?.location??""} ${j.workplaceType??""}`),url:j.hostedUrl,description:clean(j.descriptionPlain??j.description),stack:[]}))}
 const r=await fetch(`https://api.ashbyhq.com/posting-api/job-board/${ref}`);if(!r.ok)throw new Error(`Ashby respondeu ${r.status}`);const data=await r.json() as any;return (data.jobs??[]).map((j:any)=>({externalId:j.id??j.jobUrl,company,title:j.title,location:j.location??"",workMode:j.isRemote?"Remoto":mode(j.location??""),publishedAt:j.publishedAt,url:j.jobUrl??j.applyUrl,description:clean(j.descriptionPlain??j.descriptionHtml),stack:[]}));
}
