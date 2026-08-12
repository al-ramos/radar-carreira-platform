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
const HYBRID_TERMS = ["híbrido", "hibrido", "hybrid", "flexível", "flexivel"];

/** Sinais suficientes para separar vagas de TI de funções administrativas ou comerciais. */
const TECHNOLOGY_JOB_RE = /\b(?:desenvolv(?:edor|edora|imento)|developer|software|programa(?:dor|dora|ção)|engenheir[oa]\s+(?:de\s+)?(?:software|dados|data|cloud)|analista\s+(?:de\s+)?(?:sistemas|dados|data|infra(?:estrutura)?|segurança|security|qa)|(?:full[ -]?stack|front[ -]?end|back[ -]?end|devops|sre|devsecops|cybersecurity|cibersegurança|cloud|infraestrutura|tecnologia(?:s)?\s+(?:da\s+)?informa(?:ç|c)ão|\bti\b|ci[eê]ncia\s+de\s+dados|data\s+(?:engineer|scientist|analyst)|machine\s+learning|ia\b|qa\b|test(?:er|es)|arquitet[oa]\s+(?:de\s+)?software))\b/i;

/** Só vagas técnicas recebem pontos; vagas fora de TI continuam visíveis, mas sem aderência calculada. */
export function isTechnologyJob(job: Pick<ScoreInput, "title" | "description" | "stack">): boolean {
 const text=`${job.title} ${job.description}`;
 return TECHNOLOGY_JOB_RE.test(text)||job.stack.some(skill=>Boolean(skill.trim()));
}

// Cidades aceitas para presencial/híbrido
const ACCEPTED_CITIES = [
  "são paulo", "sao paulo", "sp", "mogi das cruzes", "mogi", "grande são paulo", "grande sp", "abc paulista",
];

function profilePrefersRemote(modes: string[]): boolean {
  return modes.some(m => REMOTE_TERMS.includes(normalize(m)));
}
function profilePrefersOnsite(modes: string[]): boolean {
  return modes.some(m => ONSITE_TERMS.includes(normalize(m)));
}

/** Retorna true se a localização da vaga é aceita para trabalho presencial/híbrido */
function isAcceptedLocation(location: string | null | undefined): boolean {
  if (!location) return true; // sem info = não penaliza
  const loc = normalize(location);
  return ACCEPTED_CITIES.some(city => loc.includes(city));
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
 if(!isTechnologyJob(job))return{score:0,reasons:["Vaga fora do escopo de TI — sem pontuação"]};
 const text=`${job.title} ${job.description} ${job.stack.join(" ")}`;
 if(has(text,profile.avoidTerms))return{score:0,reasons:["Contém termo bloqueado"]};
 let score=5;const reasons:string[]=["Vaga de TI (+5)"];

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
     // Mostra faltantes apenas quando houve match parcial (não quando nenhuma bateu)
     if(unmatchedSkills.length > 0 && unmatchedSkills.length <= 4){
       reasons.push(`❌ Não menciona: ${unmatchedSkills.join(", ")}`);
     }
   } else {
     reasons.push(`Nenhuma das ${selectedSkills.length} skills foi encontrada`);
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

 // --- Modalidade + localização ---
 const jobMode = normalize(job.workMode ?? "");
 const isOnsite = ONSITE_TERMS.some(t=>jobMode.includes(t));
 const isHybrid = HYBRID_TERMS.some(t=>jobMode.includes(t));
 const isRemote = REMOTE_TERMS.some(t=>jobMode.includes(t));
 const acceptedLoc = isAcceptedLocation(job.location);

 if(profile.preferredMode.length){
   const modeMatch = profile.preferredMode.some(mode=>normalize(mode)===jobMode);
   if(modeMatch){
     // Presencial/híbrido na cidade certa: bônus normal; fora: penalidade
     if((isOnsite || isHybrid) && !acceptedLoc){
       score-=20;
       reasons.push(`⚠️ ${isHybrid?"Híbrido":"Presencial"} fora de SP/Mogi (${job.location ?? "sem cidade"}) (-20)`);
     } else {
       score+=10;
       reasons.push("Modalidade preferida (+10)");
       if(isOnsite||isHybrid) reasons.push(`📍 ${job.location ?? "localização compatível"}`);
     }
   } else if(profilePrefersRemote(profile.preferredMode) && (isOnsite||isHybrid)){
     // Prefere remoto mas vaga é presencial/híbrido
     if(!acceptedLoc){
       score-=25;
       reasons.push(`⚠️ Presencial/híbrido fora de SP/Mogi (você prefere remoto) (-25)`);
     } else {
       score-=10;
       reasons.push(`⚠️ Híbrido/presencial em SP (você prefere remoto) (-10)`);
     }
   } else if(profilePrefersOnsite(profile.preferredMode) && isRemote){
     score-=5;
     reasons.push("Vaga remota (você prefere presencial) (-5)");
   }
 } else if((isOnsite||isHybrid) && !acceptedLoc){
   // Perfil sem seleção: informa apenas se for fora das cidades aceitas
   reasons.push(`📍 ${isHybrid?"Híbrido":"Presencial"} — ${job.location ?? "cidade não informada"}`);
 }

 // --- Recência (+5) ---
 const age=job.publishedAt?(Date.now()-job.publishedAt.getTime())/36e5:999;
 if(age<=24){score+=5;reasons.push("Publicada nas últimas 24h (+5)")}

 return{score:Math.max(0,Math.min(100,score)),reasons};
}
