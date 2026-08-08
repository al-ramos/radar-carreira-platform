import type { ImportedJob } from "./jobs";

export type RadarEmail={id:string;from:string;subject:string;date:string;body:string};
export type ApplicationSignal={title?:string;company?:string;stage:"applied";type:"application_sent"|"application_viewed";detail:string};

const applicationLine=/^(?:candidate-se|candidatar-se|candidatura simplificada|easy apply)\b/i;
const jobUrl=/https:\/\/www\.linkedin\.com\/(?:comm\/)?jobs\/view\/(\d+)[^\s]*/i;

function jobBlocks(body:string){
  const lines=body.replace(/\r/g,"").split("\n").map(line=>line.replace(/[\u200B-\u200D\uFEFF]/g,"").trim());
  const blocks:Array<{title:string;company:string;location:string;id:string}>=[];
  for(let index=0;index<lines.length;index++){
    if(!/^Visualizar vaga\s*:/i.test(lines[index]))continue;
    const nearby=lines.slice(index,index+4).join(" "),url=nearby.match(jobUrl);
    if(!url)continue;
    const fields=lines.slice(Math.max(0,index-14),index)
      .filter(Boolean)
      .filter(line=>!applicationLine.test(line))
      .filter(line=>!jobUrl.test(line));
    const [title,company,location]=fields.slice(-3);
    if(title&&company&&location)blocks.push({title,company,location,id:url[1]});
  }
  return blocks;
}

export function jobsFromEmail(email:RadarEmail):ImportedJob[]{
  if(!/@linkedin\.com/i.test(email.from))return[];
  return jobBlocks(email.body).map(({title,company,location,id})=>({externalId:id,company,title,location,workMode:/remot/i.test(location)?"Remoto":undefined,publishedAt:new Date(email.date).toISOString(),url:`https://www.linkedin.com/jobs/view/${id}/`,description:`Importada do alerta RadarVagas: ${email.subject}`,stack:[]}));
}

export function applicationFromEmail(email:RadarEmail):ApplicationSignal|null{
  const subject=email.subject.trim();
  let match=subject.match(/^Sua candidatura a (.+) na (.+)$/i);
  if(match)return{title:match[1].trim(),company:match[2].trim(),stage:"applied",type:"application_sent",detail:subject};
  match=subject.match(/você se candidatou à vaga de (.+?)[.]?$/i);
  if(match)return{title:match[1].trim(),stage:"applied",type:"application_sent",detail:subject};
  match=subject.match(/^Sua candidatura foi enviada para a empresa (.+)$/i);
  if(match)return{company:match[1].trim(),stage:"applied",type:"application_sent",detail:subject};
  match=subject.match(/^Sua candidatura foi vista pela (.+)$/i);
  if(match)return{company:match[1].trim(),stage:"applied",type:"application_viewed",detail:subject};
  return null;
}
