import { and,eq,isNotNull,isNull,like,sql } from "drizzle-orm";
import { getDb } from "../db/index";
import { jobEvents,jobs } from "../db/schema";

const normalize=(value:string)=>value.normalize("NFD").replace(/\p{Mn}/gu,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();

/**
 * Preenche a descrição/stack de uma vaga importada por e-mail (RadarVagas)
 * com os dados da mesma vaga já coletada oficialmente (ex.: APInfo).
 *
 * Antes esta função carregava TODAS as vagas ativas do banco (dezenas de
 * milhares) para comparar cada alvo contra o total em memória — um custo
 * que crescia com o tamanho do banco inteiro e estourava o limite de CPU do
 * Worker (erro 1102 do Cloudflare) mesmo com poucos e-mails novos. Agora
 * busca primeiro só os alvos (poucos: vagas do RadarVagas ainda não
 * enriquecidas) e, para cada um, filtra os candidatos oficiais pela mesma
 * empresa direto no banco antes de comparar em memória — a comparação por
 * título continua exata (normaliza acento/pontuação), só o universo
 * pré-filtrado é que fica pequeno. A comparação de empresa usa igualdade
 * exata sem acentos no banco (mais estrita que o normalize antigo), uma
 * troca aceitável para não voltar a carregar a tabela inteira.
 */
export async function enrichLinkedInJobs(){
  const db=getDb();
  const targets=await db.select().from(jobs).where(and(
    eq(jobs.status,"active"),
    isNull(jobs.sourceId),
    like(jobs.description,"Importada do alerta RadarVagas:%"),
  ));
  let enriched=0;
  for(const target of targets){
    const candidates=await db.select().from(jobs).where(and(
      eq(jobs.status,"active"),
      isNotNull(jobs.sourceId),
      sql`length(${jobs.description}) > 80`,
      sql`lower(${jobs.company}) = lower(${target.company})`,
    ));
    const matches=candidates.filter(job=>normalize(job.title)===normalize(target.title));
    if(matches.length!==1)continue;
    const source=matches[0];
    await db.update(jobs).set({description:source.description,stack:source.stack,seniority:source.seniority,workMode:source.workMode??target.workMode,location:source.location??target.location,updatedAt:new Date()}).where(eq(jobs.id,target.id));
    await db.insert(jobEvents).values({jobId:target.id,type:"official_enrichment",detail:`Descrição enriquecida pela fonte oficial: ${source.url}`,occurredAt:new Date()});
    enriched++;
  }
  return enriched;
}
