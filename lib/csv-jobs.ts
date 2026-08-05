import type { ImportedJob } from "./jobs";

const aliases:Record<string,keyof ImportedJob>={
 company:"company",empresa:"company",title:"title",titulo:"title",cargo:"title",url:"url",link:"url",
 description:"description",descricao:"description",location:"location",local:"location",localidade:"location",
 workmode:"workMode",modalidade:"workMode",seniority:"seniority",senioridade:"seniority",
 stack:"stack",tecnologias:"stack",publishedat:"publishedAt",publicadoem:"publishedAt",data:"publishedAt",
 externalid:"externalId",idexterno:"externalId"
};
const normalize=(v:string)=>v.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");
function rows(input:string,delimiter:string){const output:string[][]=[];let row:string[]=[],field="",quoted=false;for(let i=0;i<input.length;i++){const c=input[i];if(c==='"'){if(quoted&&input[i+1]==='"'){field+='"';i++}else quoted=!quoted}else if(c===delimiter&&!quoted){row.push(field.trim());field=""}else if((c==="\n"||c==="\r")&&!quoted){if(c==="\r"&&input[i+1]==="\n")i++;row.push(field.trim());if(row.some(Boolean))output.push(row);row=[];field=""}else field+=c}row.push(field.trim());if(row.some(Boolean))output.push(row);return output}
export function parseCsvJobs(input:string):ImportedJob[]{const clean=input.replace(/^\uFEFF/,"").trim();if(!clean)return[];const first=clean.split(/\r?\n/,1)[0],delimiter=(first.match(/;/g)?.length??0)>(first.match(/,/g)?.length??0)?";":",",table=rows(clean,delimiter);if(table.length<2)return[];const headers=table[0].map(h=>aliases[normalize(h)]);return table.slice(1,2001).map(columns=>{const item:Record<string,unknown>={};headers.forEach((key,index)=>{if(!key)return;const value=columns[index]?.trim();if(!value)return;item[key]=key==="stack"?value.split(/[|,]/).map(v=>v.trim()).filter(Boolean):value});return item as ImportedJob})}
