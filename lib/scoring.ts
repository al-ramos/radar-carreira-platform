export type ScoreInput={title:string;description:string;stack:string[];seniority?:string|null;workMode?:string|null;location?:string|null;publishedAt?:Date|null};
export type ScoreProfile={masteredSkills:string[];desiredAreas:string[];avoidTerms:string[];seniority:string[];preferredMode:string[]};
const normalize=(value:string)=>value.trim().toLocaleLowerCase("pt-BR");
const escapeRegex=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
// A busca por limite evita, por exemplo, que a competência "R" seja contada em "React"
// ou que "Go" seja encontrada dentro de outra palavra.
const containsTerm=(text:string,term:string)=>new RegExp(`(^|[^a-z0-9+#.])${escapeRegex(term)}(?=$|[^a-z0-9+#.])`,"i").test(text);
const has=(text:string,terms:string[])=>terms.some(term=>containsTerm(text,term));
/**
 * "Senioridades aceitas" is an eligibility rule, unlike the score boost used
 * to explain affinity. A vacancy without a declared seniority cannot be
 * verified against a selected level and must not bypass this rule.
 */
export function matchesSelectedSeniority(jobSeniority:string|null|undefined,selectedSeniority:string[]){
 return !selectedSeniority.length||Boolean(jobSeniority&&selectedSeniority.some(level=>normalize(jobSeniority).includes(normalize(level))));
}
export function scoreJob(job:ScoreInput,profile:ScoreProfile){
 const text=`${job.title} ${job.description} ${job.stack.join(" ")}`;
 if(has(text,profile.avoidTerms))return{score:0,reasons:["Contém termo bloqueado"]};
 let score=0;const reasons:string[]=[];
 const selectedSkills=[...new Map(profile.masteredSkills.filter(Boolean).map(skill=>[normalize(skill),skill.trim()])).values()];
 const matchedSkills=selectedSkills.filter(skill=>containsTerm(text,skill));
 if(selectedSkills.length){
   const points=Math.round(60*matchedSkills.length/selectedSkills.length);
   score+=points;
   reasons.push(matchedSkills.length?`${matchedSkills.length} de ${selectedSkills.length} stacks atendidas (+${points})`:`Nenhuma das ${selectedSkills.length} stacks selecionadas foi encontrada`);
 }
 if(has(text,profile.desiredAreas)){score+=15;reasons.push("Área desejada (+15)")}
 if(matchesSelectedSeniority(job.seniority,profile.seniority)&&profile.seniority.length){score+=10;reasons.push("Senioridade ideal (+10)")}
 if(job.workMode&&profile.preferredMode.some(mode=>normalize(job.workMode!)===normalize(mode))){score+=10;reasons.push("Modalidade preferida (+10)")}
 const age=job.publishedAt?(Date.now()-job.publishedAt.getTime())/36e5:999;if(age<=24){score+=5;reasons.push("Publicada nas últimas 24h (+5)")}
 return{score:Math.min(100,score),reasons};
}
