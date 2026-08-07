export type ScoreInput={title:string;description:string;stack:string[];seniority?:string|null;workMode?:string|null;location?:string|null;publishedAt?:Date|null};
export type ScoreProfile={masteredSkills:string[];desiredAreas:string[];avoidTerms:string[];seniority:string[];preferredMode:string[]};
const normalize=(value:string)=>value.trim().toLocaleLowerCase("pt-BR");
const escapeRegex=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
// A busca por limite evita, por exemplo, que a competência "R" seja contada em "React"
// ou que "Go" seja encontrada dentro de outra palavra.
const containsTerm=(text:string,term:string)=>new RegExp(`(^|[^a-z0-9+#.])${escapeRegex(term)}(?=$|[^a-z0-9+#.])`,"i").test(text);
const has=(text:string,terms:string[])=>terms.some(term=>containsTerm(text,term));

// Mapeia termos de senioridade no título para nível canônico
const SENIORITY_SIGNALS: [RegExp, string][] = [
  [/\b(jr\.?|júnior|junior)\b/i, "Júnior"],
  [/\b(pl\.?|pleno)\b/i, "Pleno"],
  [/\b(sr\.?|sênior|senior|staff|principal|lead)\b/i, "Sênior"],
];

function detectTitleSeniority(title: string): string | null {
  for (const [re, level] of SENIORITY_SIGNALS) {
    if (re.test(title)) return level;
  }
  return null;
}

const REMOTE_TERMS = ["remoto", "remote", "home office"];
const ONSITE_TERMS = ["presencial", "on-site", "onsite", "in-office"];

function profilePrefersRemote(modes: string[]): boolean {
  return modes.some(m => REMOTE_TERMS.includes(normalize(m)));
}
function profilePrefersOnsite(modes: string[]): boolean {
  return modes.some(m => ONSITE_TERMS.includes(normalize(m)));
}

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

 // --- Skills (até 60 pts) ---
 const selectedSkills=[...new Map(profile.masteredSkills.filter(Boolean).map(skill=>[normalize(skill),skill.trim()])).values()];
 const matchedSkills=selectedSkills.filter(skill=>containsTerm(text,skill));
 const unmatchedSkills=selectedSkills.filter(skill=>!containsTerm(text,skill));
 if(selectedSkills.length){
   const points=Math.round(60*matchedSkills.length/selectedSkills.length);
   score+=points;
   if(matchedSkills.length){
     const shown=matchedSkills.slice(0,5).join(", ")+(matchedSkills.length>5?` +${matchedSkills.length-5}`:"");
     reasons.push(`✅ Skills: ${shown} (+${points})`);
   } else {
     reasons.push(`Nenhuma das ${selectedSkills.length} skills foi encontrada`);
   }
   if(unmatchedSkills.length && unmatchedSkills.length <= 4){
     reasons.push(`❌ Não menciona: ${unmatchedSkills.join(", ")}`);
   }
 }

 // --- Área desejada (+15) ---
 if(has(text,profile.desiredAreas)){score+=15;reasons.push("Área desejada (+15)")}

 // --- Senioridade: match do perfil (+10) ou mismatch no título (-10) ---
 const titleSeniority = detectTitleSeniority(job.title);
 if(profile.seniority.length){
   if(matchesSelectedSeniority(job.seniority,profile.seniority)){
     score+=10;
     reasons.push("Senioridade compatível (+10)");
   } else if(titleSeniority){
     score-=10;
     reasons.push(`⚠️ Título indica ${titleSeniority}, não está na sua lista (-10)`);
   }
 } else if(titleSeniority){
   reasons.push(`Nível indicado no título: ${titleSeniority}`);
 }

 // --- Modalidade: match (+10) / presencial quando prefere remoto (-15) / remoto quando prefere presencial (-5) ---
 const jobMode = normalize(job.workMode ?? "");
 if(profile.preferredMode.length){
   const modeMatch = profile.preferredMode.some(mode=>normalize(mode)===jobMode);
   if(modeMatch){
     score+=10;
     reasons.push("Modalidade preferida (+10)");
   } else if(profilePrefersRemote(profile.preferredMode) && ONSITE_TERMS.some(t=>jobMode.includes(t))){
     score-=15;
     reasons.push("⚠️ Vaga presencial (você prefere remoto) (-15)");
   } else if(profilePrefersOnsite(profile.preferredMode) && REMOTE_TERMS.some(t=>jobMode.includes(t))){
     score-=5;
     reasons.push("Vaga remota (você prefere presencial) (-5)");
   }
 }

 // --- Recência (+5) ---
 const age=job.publishedAt?(Date.now()-job.publishedAt.getTime())/36e5:999;
 if(age<=24){score+=5;reasons.push("Publicada nas últimas 24h (+5)")}

 return{score:Math.max(0,Math.min(100,score)),reasons};
}
