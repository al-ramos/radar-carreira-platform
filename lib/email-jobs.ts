import type { ImportedJob } from "./jobs";

export type RadarEmail={id:string;from:string;subject:string;date:string;body:string};
export type ApplicationSignal={title?:string;company?:string;stage:"applied";type:"application_sent"|"application_viewed";detail:string};

const applicationLine=/^(?:candidate-se|candidatar-se|candidatura simplificada|easy apply)\b/i;
const jobUrl=/https:\/\/www\.linkedin\.com\/(?:comm\/)?jobs\/view\/(\d+)[^\s]*/i;
// Metadados de interface do LinkedIn que aparecem perto do link "Visualizar
// vaga" mas nao sao titulo/empresa/local da vaga (ex.: selos de "melhor
// candidato", contagem de conexoes/ex-alunos). Sem filtrar essas linhas, o
// deslocamento empurra o titulo real para fora da janela e o selo acaba
// sendo lido como se fosse o local da vaga.
const noiseLine=/^(?:\d+\s+(?:ex-alunos?|conex(?:ão|ões))\b.*|melhor candidato|crescimento rápido)$/i;

function jobBlocks(body:string){
  const lines=body.replace(/\r/g,"").split("\n").map(line=>line.replace(/[​-‍﻿]/g,"").trim());
  const blocks:Array<{title:string;company:string;location:string;id:string}>=[];
  // Um e-mail do RadarVagas costuma reunir varias vagas recomendadas no
  // mesmo corpo. `previousEnd` marca onde terminou o bloco anterior para a
  // janela de campos nunca atravessar para tras do "Visualizar vaga" de
  // outra vaga - sem isso, titulo/empresa de um bloco vizinho vazam para
  // dentro do bloco seguinte.
  let previousEnd=0;
  for(let index=0;index<lines.length;index++){
    if(!/^Visualizar vaga\s*:/i.test(lines[index]))continue;
    const nearby=lines.slice(index,index+4).join(" "),url=nearby.match(jobUrl);
    if(!url){previousEnd=index+1;continue}
    const fields=lines.slice(Math.max(previousEnd,index-14),index)
      .filter(Boolean)
      .filter(line=>!applicationLine.test(line))
      .filter(line=>!jobUrl.test(line))
      .filter(line=>!noiseLine.test(line));
    const [title,company,location]=fields.slice(-3);
    // Se algum dos tres campos ainda bater com metadado de interface, o
    // bloco nao tem titulo/empresa/local extraiveis com confianca - melhor
    // descartar a notificacao do que gravar uma vaga com campos trocados.
    if(title&&company&&location&&![title,company,location].some(field=>noiseLine.test(field)))
      blocks.push({title,company,location,id:url[1]});
    previousEnd=index+1;
  }
  return blocks;
}

export function jobsFromEmail(email:RadarEmail):ImportedJob[]{
  if(!/@linkedin\.com/i.test(email.from))return[];
  // A descricao nao pode reaproveitar o assunto do e-mail: um unico e-mail
  // do RadarVagas pode reunir varias vagas recomendadas junto de um aviso
  // de candidatura ("Alex, sua candidatura foi enviada a ...") que nao tem
  // relacao com nenhuma delas - reaproveitar o assunto grava um aviso de
  // candidatura como se fosse a descricao da vaga. A descricao e montada a
  // partir dos proprios campos extraidos do bloco da vaga.
  return jobBlocks(email.body).map(({title,company,location,id})=>({externalId:id,company,title,location,workMode:/remot/i.test(location)?"Remoto":undefined,publishedAt:new Date(email.date).toISOString(),url:`https://www.linkedin.com/jobs/view/${id}/`,description:`Importada do alerta RadarVagas: vaga de ${title} na ${company} (LinkedIn).`,stack:[]}));
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
