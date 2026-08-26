import type { ImportedJob } from "./jobs";

const aliases:Record<string,keyof ImportedJob>={
 company:"company",empresa:"company",title:"title",titulo:"title",cargo:"title",url:"url",link:"url",
 description:"description",descricao:"description",location:"location",local:"location",localidade:"location",
 workmode:"workMode",modalidade:"workMode",seniority:"seniority",senioridade:"seniority",
 stack:"stack",tecnologias:"stack",publishedat:"publishedAt",publicadoem:"publishedAt",datapublicacao:"publishedAt",data:"publishedAt",
 externalid:"externalId",idexterno:"externalId",sourceid:"sourceId",
 applyurl:"applyUrl",linkcandidatura:"applyUrl",linkdecandidatura:"applyUrl",
 contactemail:"contactEmail",emailcontato:"contactEmail",email:"contactEmail",
 contactsubject:"contactSubject",assuntoemail:"contactSubject",assunto:"contactSubject",applicationclosed:"applicationClosed",encerrada:"applicationClosed"
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
 return inspectImportedJob(value).job;
}

export type ImportInputDiagnostics={items:ImportedJob[];rejected:number;reasons:Record<string,number>};

function inspectImportedJob(value:unknown):{job:ImportedJob|null;reasons:string[]}{
 if(!value||typeof value!=="object"||Array.isArray(value))return{job:null,reasons:["registro inválido"]};
 const source=value as Record<string,unknown>,mapped:Record<string,unknown>={};
 for(const [rawKey,rawValue] of Object.entries(source)){
  const key=aliases[normalizeHeader(rawKey)];
  if(key&&rawValue!==null&&rawValue!==undefined)mapped[key]=rawValue;
 }
 const string=(key:keyof ImportedJob)=>typeof mapped[key]==="string"?String(mapped[key]).trim():"";
 const company=string("company"),title=string("title"),url=string("url");
 const reasons=[!company?"empresa ausente":"",!title?"título ausente":"",!url?"link da vaga ausente":""].filter(Boolean);
 if(reasons.length)return{job:null,reasons};
 const rawLocation=string("location"),description=string("description"),linkedinId=url.match(/linkedin\.com\/jobs\/view\/(\d+)/i)?.[1],applicationClosed=mapped.applicationClosed===true||/n[aã]o aceita mais candidaturas|no longer accepting applications/i.test(`${description} ${String(source.applicationClosed??"")}`);
 const stack=Array.isArray(mapped.stack)?mapped.stack.map(String).map(item=>item.trim()).filter(Boolean):typeof mapped.stack==="string"?mapped.stack.split(/[|,]/).map(item=>item.trim()).filter(Boolean):undefined;
 return {job:{
  company,title,url,description,
  location:rawLocation?cleanLocation(rawLocation):undefined,
  workMode:string("workMode")||inferWorkMode(rawLocation,description),
  seniority:string("seniority")||undefined,
  stack,
  publishedAt:string("publishedAt")||undefined,
  externalId:string("externalId")||linkedinId,
  applyUrl:string("applyUrl")||undefined,
  contactEmail:string("contactEmail")||undefined,
  contactSubject:string("contactSubject")||undefined,
  sourceId:string("sourceId")||undefined,
  ...(applicationClosed?{applicationClosed:true}:{})
 },reasons:[]};
}

export function normalizeImportedJobs(values:unknown[]):ImportedJob[]{
 return values.map(normalizeImportedJob).filter((job):job is ImportedJob=>job!==null);
}

export function normalizeImportedJobsWithDiagnostics(values:unknown[]):ImportInputDiagnostics{
 const items:ImportedJob[]=[],reasons:Record<string,number>={};
 for(const value of values){
  const result=inspectImportedJob(value);
  if(result.job){items.push(result.job);continue}
  for(const reason of result.reasons)reasons[reason]=(reasons[reason]??0)+1;
 }
 return{items,rejected:values.length-items.length,reasons};
}
