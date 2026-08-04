import type { ImportedJob } from "./jobs";

export type RadarEmail={id:string;from:string;subject:string;date:string;body:string};
export type ApplicationSignal={title?:string;company?:string;stage:"applied";type:"application_sent"|"application_viewed";detail:string};

export function jobsFromEmail(email:RadarEmail):ImportedJob[]{
  if(!/@linkedin\.com/i.test(email.from))return[];
  const jobs:ImportedJob[]=[];
  const pattern=/(?:^|\n)\s*([^\n]+)\n\s*([^\n]+)\n\s*([^\n]+)\n\s*Visualizar vaga:\s*(https:\/\/www\.linkedin\.com\/(?:comm\/)?jobs\/view\/(\d+)[^\s]*)/gi;
  for(const match of email.body.matchAll(pattern)){
    const [,title,company,location,,id]=match;
    if(!title||!company||!id)continue;
    jobs.push({externalId:id,company:company.trim(),title:title.trim(),location:location.trim(),workMode:/remot/i.test(location)?"Remoto":undefined,publishedAt:new Date(email.date).toISOString(),url:`https://www.linkedin.com/jobs/view/${id}/`,description:`Importada do alerta RadarVagas: ${email.subject}`,stack:[]});
  }
  return jobs;
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
