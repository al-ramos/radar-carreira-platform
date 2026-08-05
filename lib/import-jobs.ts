import type { ImportedJob } from "./jobs";

const aliases:Record<string,keyof ImportedJob>={
 company:"company",empresa:"company",title:"title",titulo:"title",cargo:"title",url:"url",link:"url",
 description:"description",descricao:"description",location:"location",local:"location",localidade:"location",
 workmode:"workMode",modalidade:"workMode",seniority:"seniority",senioridade:"seniority",
 stack:"stack",tecnologias:"stack",publishedat:"publishedAt",publicadoem:"publishedAt",data:"publishedAt",
 coletadoem:"publishedAt",externalid:"externalId",idexterno:"externalId",sourceid:"sourceId"
};

export const normalizeHeader=(value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");

function cleanLocation(value:string){
 return value.split(/\s+·\s+/)[0]?.trim()??value.trim();
}

function inferWorkMode(location:string,description:string){
 const text=`${location} ${description}`;
 if(/\bh[ií]brid[oa]\b/i.test(text))return "Híbrido";
 if(/\bremot[oa]\b|home\s*office/i.test(text))return "Remoto";
 if(/\bpresencial\b/i.test(text))return "Presencial";
 return undefined;
}

export function normalizeImportedJob(value:unknown):ImportedJob|null{
 if(!value||typeof value!=="object"||Array.isArray(value))return null;
 const source=value as Record<string,unknown>,mapped:Record<string,unknown>={};
 for(const [rawKey,rawValue] of Object.entries(source)){
  const key=aliases[normalizeHeader(rawKey)];
  if(key&&rawValue!==null&&rawValue!==undefined)mapped[key]=rawValue;
 }
 const string=(key:keyof ImportedJob)=>typeof mapped[key]==="string"?String(mapped[key]).trim():"";
 const company=string("company"),title=string("title"),url=string("url");
 if(!company||!title||!url)return null;
 const rawLocation=string("location"),description=string("description"),linkedinId=url.match(/linkedin\.com\/jobs\/view\/(\d+)/i)?.[1];
 const stack=Array.isArray(mapped.stack)?mapped.stack.map(String).map(item=>item.trim()).filter(Boolean):typeof mapped.stack==="string"?mapped.stack.split(/[|,]/).map(item=>item.trim()).filter(Boolean):undefined;
 return {
  company,title,url,description,
  location:rawLocation?cleanLocation(rawLocation):undefined,
  workMode:string("workMode")||inferWorkMode(rawLocation,description),
  seniority:string("seniority")||undefined,
  stack,
  publishedAt:string("publishedAt")||undefined,
  externalId:string("externalId")||linkedinId,
  sourceId:string("sourceId")||undefined
 };
}

export function normalizeImportedJobs(values:unknown[]):ImportedJob[]{
 return values.map(normalizeImportedJob).filter((job):job is ImportedJob=>job!==null);
}
