export type ScoreInput={title:string;description:string;stack:string[];seniority?:string|null;workMode?:string|null;location?:string|null;publishedAt?:Date|null};
export type ScoreProfile={masteredSkills:string[];desiredAreas:string[];avoidTerms:string[];seniority:string[];preferredMode:string[]};
const has=(text:string,terms:string[])=>terms.some(term=>text.includes(term.toLowerCase()));
export function scoreJob(job:ScoreInput,profile:ScoreProfile){
 const text=`${job.title} ${job.description} ${job.stack.join(" ")}`.toLowerCase();
 if(has(text,profile.avoidTerms))return{score:0,reasons:["Contém termo bloqueado"]};
 let score=0;const reasons:string[]=[];
 const hits=profile.masteredSkills.filter(skill=>text.includes(skill.toLowerCase())).length;
 if(profile.masteredSkills.length){const points=Math.round(35*hits/profile.masteredSkills.length);score+=points;if(points)reasons.push(`${hits} competências aderentes`)}
 if(has(text,profile.desiredAreas)){score+=25;reasons.push("Área desejada")}
 if(job.seniority&&profile.seniority.some(level=>job.seniority?.toLowerCase().includes(level.toLowerCase()))){score+=15;reasons.push("Senioridade ideal")}
 if(job.workMode&&profile.preferredMode.some(mode=>job.workMode===mode)){score+=15;reasons.push("Modalidade preferida")}
 const age=job.publishedAt?(Date.now()-job.publishedAt.getTime())/36e5:999;if(age<=24){score+=10;reasons.push("Publicada nas últimas 24h")}
 return{score:Math.min(100,score),reasons};
}
