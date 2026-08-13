import { scoreFamilyForSelection, type SkillFamily } from "./skill-taxonomy.ts";

export type ScoreInput={title:string;description:string;stack:string[];seniority?:string|null;workMode?:string|null;location?:string|null;publishedAt?:Date|string|null};
export type ScoreProfile={masteredSkills:string[];desiredAreas:string[];avoidTerms:string[];seniority:string[];preferredMode:string[]};
const normalize=(value:string)=>value.trim().toLocaleLowerCase("pt-BR");
const escapeRegex=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
// A busca por limite evita, por exemplo, que a competência "R" seja contada em "React"
// ou que "Go" seja encontrada dentro de outra palavra.
const containsTerm=(text:string,term:string)=>new RegExp(`(^|[^a-z0-9+#.])${escapeRegex(term)}(?=$|[^a-z0-9+#.])`,"i").test(text);

// A aderência mede famílias tecnológicas, não a quantidade de checkboxes do
// perfil. Assim, C# e .NET se reforçam sem punir quem também selecionou bancos.

const AREA_FAMILIES: SkillFamily[] = [
  { key: "backend", label: "Back-end", aliases: ["back-end", "backend", "back end", "desenvolvimento back-end", "desenvolvedor back-end", "backend developer", "API", "APIs"] },
  { key: "fullstack", label: "Full Stack", aliases: ["full stack", "full-stack", "fullstack"] },
  { key: "frontend", label: "Front-end", aliases: ["front-end", "frontend", "front end"] },
  { key: "data", label: "Dados", aliases: ["engenharia de dados", "data engineer", "analista de dados", "data analyst", "banco de dados", "DBA"] },
  { key: "architecture", label: "Arquitetura", aliases: ["arquitetura de software", "arquiteto de software", "software architect", "solution architect"] },
  { key: "qa", label: "QA e testes", aliases: ["QA", "quality assurance", "automação de testes", "test automation"] },
  { key: "integrations", label: "Integrações", aliases: ["integração", "integrações", "integration", "APIs"] },
];

const familyForSelection=(selection:string,families:SkillFamily[])=>{
  const selected=normalize(selection);
  return families.find(family=>family.aliases.some(alias=>normalize(alias)===selected));
};

function selectedSkillFamilies(skills:string[]): SkillFamily[] {
  const families=new Map<string,SkillFamily>();
  for(const skill of skills.filter(Boolean)){
    const known=scoreFamilyForSelection(skill);
    const family=known ?? {key:`skill:${normalize(skill)}`,label:skill.trim(),aliases:[skill.trim()]};
    families.set(family.key,family);
  }
  return [...families.values()];
}

function selectedAreaFamilies(areas:string[]): SkillFamily[] {
  const families=new Map<string,SkillFamily>();
  for(const area of areas.filter(Boolean)){
    const known=familyForSelection(area,AREA_FAMILIES) ?? scoreFamilyForSelection(area);
    const family=known ?? {key:`area:${normalize(area)}`,label:area.trim(),aliases:[area.trim()]};
    families.set(family.key,family);
  }
  return [...families.values()];
}

/** Termos ampliados usados para reduzir o conjunto consultado no banco. */
export function profileAffinitySearchTerms(masteredSkills:string[],desiredAreas:string[]): string[] {
  const terms=[
    ...selectedSkillFamilies(masteredSkills).flatMap(family=>family.aliases),
    ...selectedAreaFamilies(desiredAreas).flatMap(family=>family.aliases),
  ];
  return [...new Map(terms.map(term=>[normalize(term),term])).values()];
}

const LANGUAGE_REQUIREMENT: Record<string,RegExp> = {
  ingles: /(?:\b(?:ingl[eê]s|english)\b.{0,60}\b(?:obrigat[oó]ri[oa]|exigid[oa]|fluente|avan[cç]ad[oa]|b2|c1|c2)\b|\b(?:obrigat[oó]ri[oa]|exigid[oa]|fluente|avan[cç]ad[oa]|b2|c1|c2)\b.{0,60}\b(?:ingl[eê]s|english)\b)/i,
  espanhol: /(?:\b(?:espanhol|spanish)\b.{0,60}\b(?:obrigat[oó]ri[oa]|exigid[oa]|fluente|avan[cç]ad[oa]|b2|c1|c2)\b|\b(?:obrigat[oó]ri[oa]|exigid[oa]|fluente|avan[cç]ad[oa]|b2|c1|c2)\b.{0,60}\b(?:espanhol|spanish)\b)/i,
};

const normalizeLanguage=(value:string)=>normalize(value).normalize("NFD").replace(/[\u0300-\u036f]/g,"");

function blockedReason(text:string,avoidTerms:string[]): string|null {
  for(const term of avoidTerms.filter(Boolean)){
    const normalized=normalizeLanguage(term);
    const language=normalized === "ingles" || normalized === "english"
      ? "ingles"
      : normalized === "espanhol" || normalized === "spanish"
      ? "espanhol"
      : null;
    if(language){
      if(LANGUAGE_REQUIREMENT[language].test(text)) return `Exige ${language === "ingles" ? "inglês" : "espanhol"} avançado ou obrigatório`;
      continue;
    }
    if(containsTerm(text,term)) return `Contém termo bloqueado: ${term.trim()}`;
  }
  return null;
}

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
 const blocker=blockedReason(`${job.title} ${job.description}`,profile.avoidTerms);
 if(blocker)return{score:0,reasons:[blocker]};
 let score=5;const reasons:string[]=["Vaga de TI (+5)"];

 // --- Skills (até 60 pts) ---
 const selectedFamilies=selectedSkillFamilies(profile.masteredSkills);
 const matchedFamilies=selectedFamilies.filter(family=>family.aliases.some(alias=>containsTerm(text,alias)));
 if(selectedFamilies.length){
   const points=matchedFamilies.length === 0 ? 0 : Math.min(60,35+(matchedFamilies.length-1)*15);
   score+=points;
   if(matchedFamilies.length){
     const shown=matchedFamilies.slice(0,4).map(family=>family.label).join(", ")+(matchedFamilies.length>4?` +${matchedFamilies.length-4}`:"");
     reasons.push(`✅ ${matchedFamilies.length === 1 ? "Stack compatível" : `${matchedFamilies.length} famílias de stack compatíveis`}: ${shown} (+${points})`);
   } else {
     reasons.push("Nenhuma competência da vaga também está cadastrada em Competências dominadas do seu perfil (+0)");
   }
 }

 // --- Área desejada (+15) ---
 const matchedArea=selectedAreaFamilies(profile.desiredAreas).find(family=>family.aliases.some(alias=>containsTerm(text,alias)));
 if(matchedArea){score+=15;reasons.push(`Área desejada: ${matchedArea.label} (+15)`)}

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
 // O D1 pode devolver a data como texto no Worker. Aceitamos os dois formatos
 // para que uma data válida jamais interrompa o cálculo de aderência.
 const publishedAt=job.publishedAt instanceof Date?job.publishedAt:job.publishedAt?new Date(job.publishedAt):null;
 const age=publishedAt&&!Number.isNaN(publishedAt.getTime())?(Date.now()-publishedAt.getTime())/36e5:999;
 if(age<=24){score+=5;reasons.push("Publicada nas últimas 24h (+5)")}

 return{score:Math.max(0,Math.min(100,score)),reasons};
}
