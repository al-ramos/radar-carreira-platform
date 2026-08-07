import type { ImportedJob } from "./jobs";
export const PULL_PROVIDERS=["greenhouse","lever","ashby"] as const;
export type Provider=typeof PULL_PROVIDERS[number];
export const isPullProvider=(provider:string):provider is Provider=>(PULL_PROVIDERS as readonly string[]).includes(provider);
type GreenhouseJob={id:string|number;title:string;updated_at?:string;absolute_url:string;content?:string;location?:{name?:string}};
type LeverJob={id:string;text:string;hostedUrl:string;descriptionPlain?:string;description?:string;workplaceType?:string;categories?:{location?:string}};
type AshbyJob={id?:string;title:string;location?:string;isRemote?:boolean;publishedAt?:string;jobUrl?:string;applyUrl?:string;descriptionPlain?:string;descriptionHtml?:string};
type AshbyResponse={jobs?:AshbyJob[];organization?:{name?:string}};

export type CollectResult={status:"ok"|"empty"|"mismatch"|"error";jobsCount:number;foundName?:string};

const safe=(value:string)=>{if(!/^[a-zA-Z0-9_-]+$/.test(value))throw new Error("Identificador da fonte inválido");return value};
const clean=(html:string="")=>html.replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/\s+/g," ").trim();
const mode=(text:string)=>/remote|remoto/i.test(text)?"Remoto":/hybrid|híbrido|hibrido/i.test(text)?"Híbrido":"Presencial";

function nameSimilarity(a:string,b:string):number{
  const norm=(s:string)=>s.toLowerCase().replace(/[^a-z0-9\s]/g,"").trim();
  const na=norm(a),nb=norm(b);
  if(na===nb)return 1;
  if(na.includes(nb)||nb.includes(na))return 0.9;
  const ta=na.split(/\s+/).filter(Boolean),tb=new Set(nb.split(/\s+/).filter(Boolean));
  const common=ta.filter(t=>tb.has(t)).length;
  return common/Math.max(ta.length,tb.size,1);
}

export async function validate(provider:Provider|string,externalRef:string,expectedName:string):Promise<CollectResult>{
  if(!isPullProvider(provider))return{status:"error",jobsCount:0};
  const ref=safe(externalRef);
  try{
    if(provider==="greenhouse"){
      const r=await fetch(`https://boards-api.greenhouse.io/v1/boards/${ref}/jobs?content=true`);
      if(!r.ok)return{status:"error",jobsCount:0};
      const data=await r.json() as{jobs?:GreenhouseJob[]};
      const jobsCount=(data.jobs??[]).length;
      if(jobsCount===0)return{status:"empty",jobsCount:0};
      const br=await fetch(`https://boards-api.greenhouse.io/v1/boards/${ref}`);
      const foundName=br.ok?((await br.json() as{name?:string}).name):undefined;
      if(foundName&&nameSimilarity(foundName,expectedName)<0.7)return{status:"mismatch",jobsCount,foundName};
      return{status:"ok",jobsCount,foundName};
    }
    if(provider==="lever"){
      const r=await fetch(`https://api.lever.co/v0/postings/${ref}?mode=json`);
      if(!r.ok)return{status:"error",jobsCount:0};
      const data=await r.json() as LeverJob[];
      const jobsCount=data.length;
      if(jobsCount===0)return{status:"empty",jobsCount:0};
      return{status:"ok",jobsCount};
    }
    const r=await fetch(`https://api.ashbyhq.com/posting-api/job-board/${ref}`);
    if(!r.ok)return{status:"error",jobsCount:0};
    const data=await r.json() as AshbyResponse;
    const jobsCount=(data.jobs??[]).length;
    if(jobsCount===0)return{status:"empty",jobsCount:0};
    const foundName=data.organization?.name;
    if(foundName&&nameSimilarity(foundName,expectedName)<0.7)return{status:"mismatch",jobsCount,foundName};
    return{status:"ok",jobsCount,foundName};
  }catch{return{status:"error",jobsCount:0}}
}

export async function collect(provider:Provider|string,externalRef:string,company:string):Promise<ImportedJob[]>{
 if(!isPullProvider(provider))throw new Error("Este tipo de integração não suporta coleta automática");
 const ref=safe(externalRef);
 if(provider==="greenhouse"){const r=await fetch(`https://boards-api.greenhouse.io/v1/boards/${ref}/jobs?content=true`);if(!r.ok)throw new Error(`Greenhouse respondeu ${r.status}`);const data=await r.json() as {jobs?:GreenhouseJob[]};return (data.jobs??[]).map(j=>({externalId:String(j.id),company,title:j.title,location:j.location?.name??"",workMode:mode(j.location?.name??""),publishedAt:j.updated_at,url:j.absolute_url,description:clean(j.content),stack:[]}))}
 if(provider==="lever"){const r=await fetch(`https://api.lever.co/v0/postings/${ref}?mode=json`);if(!r.ok)throw new Error(`Lever respondeu ${r.status}`);const data=await r.json() as LeverJob[];return data.map(j=>({externalId:j.id,company,title:j.text,location:j.categories?.location??"",workMode:mode(`${j.categories?.location??""} ${j.workplaceType??""}`),url:j.hostedUrl,description:clean(j.descriptionPlain??j.description),stack:[]}))}
 const r=await fetch(`https://api.ashbyhq.com/posting-api/job-board/${ref}`);if(!r.ok)throw new Error(`Ashby respondeu ${r.status}`);const data=await r.json() as AshbyResponse;return (data.jobs??[]).map(j=>({externalId:j.id??j.jobUrl,company,title:j.title,location:j.location??"",workMode:j.isRemote?"Remoto":mode(j.location??""),publishedAt:j.publishedAt,url:j.jobUrl??j.applyUrl??"",description:clean(j.descriptionPlain??j.descriptionHtml),stack:[]}));
}
