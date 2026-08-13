import type { CareerRules } from "./profile-options";
import type { StructuredJobFacts } from "./ai-provider";

export function buildInterviewBrief(facts: StructuredJobFacts, rules: CareerRules, missingSkills: string[]) {
  const anchor = rules.anchorProject
    ? `Use como caso principal ${rules.anchorProject} Ao explicar CAP, associe COM+/MTS/DTC a CP (consistência e transações ACID), nunca a AP.`
    : "Escolha um projeto real que demonstre decisões técnicas e resultados.";
  const gaps = missingSkills.length
    ? `Prepare uma resposta honesta para: ${missingSkills.slice(0, 4).join(", ")}. Explique o que ainda não domina e conecte com experiências transferíveis, sem afirmar prática inexistente.`
    : "Reforce os requisitos comprovados no perfil com exemplos concretos.";
  const questions = facts.interviewQuestions.length ? facts.interviewQuestions : [
    "Quais resultados são esperados nos primeiros 90 dias?",
    "Como a equipe toma e registra decisões de arquitetura?",
    "Qual é o regime de contratação e a rotina presencial?",
  ];
  return { anchor, gaps, questions };
}
