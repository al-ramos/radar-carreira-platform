import type { CareerRules } from "./profile-options";

type ApinfoApplicationEmailInput = {
  title: string;
  company: string;
  externalId?: string;
  matchingSkills: string[];
  seniority: string[];
  missingSkills?: string[];
  careerRules?: CareerRules;
  contractSpecified?: boolean;
  applicantName?: string | null;
};

/**
 * Gera uma apresentação curta e verificável para candidaturas da APinfo.
 * As tecnologias recebidas aqui já são a interseção entre a descrição da
 * vaga e as competências cadastradas pelo candidato.
 */
export function buildApinfoApplicationEmail({
  title,
  company,
  externalId,
  matchingSkills,
  seniority,
  missingSkills = [],
  careerRules,
  contractSpecified,
  applicantName,
}: ApinfoApplicationEmailInput): string {
  const uniqueSkills = [...new Map(
    matchingSkills
      .map((skill) => skill.trim())
      .filter(Boolean)
      .map((skill) => [skill.toLocaleLowerCase("pt-BR"), skill]),
  ).values()].slice(0, 6);
  const addressee = company.trim() ? `equipe de recrutamento da ${company.trim()}` : "equipe de recrutamento";
  const jobReference = externalId ? ` (código ${externalId})` : "";
  const positioningLine = careerRules?.professionalTitle
    ? `Atuo como ${careerRules.professionalTitle}. ${careerRules.professionalSummary ? `${careerRules.professionalSummary.trim()}\n\n` : "\n\n"}`
    : "";
  const seniorityLine = !positioningLine && seniority.length
    ? `Atuo em nível ${seniority.join("/")} e acredito que meu perfil esteja alinhado ao momento e às responsabilidades da posição.\n\n`
    : "";
  const skillsLine = uniqueSkills.length
    ? `Ao analisar a descrição, identifiquei boa aderência técnica, especialmente em ${uniqueSkills.join(", ")}. Essas competências fazem parte do meu perfil e se relacionam diretamente aos requisitos apresentados.\n\n`
    : "A descrição da oportunidade está alinhada à minha experiência profissional e ao tipo de posição que estou buscando.\n\n";
  const uniqueMissingSkills = [...new Map(missingSkills.map(skill => [skill.toLocaleLowerCase("pt-BR"), skill])).values()].slice(0, 3);
  const gapsLine = careerRules?.discloseGapsInEmail && uniqueMissingSkills.length
    ? `Como ponto de transparência, ainda não tenho experiência comprovada em ${uniqueMissingSkills.join(", ")}, requisitos que aparecem na vaga. Tenho interesse em aprofundar esses conhecimentos sem superestimar minha experiência atual.\n\n`
    : "";
  const anchorLine = careerRules?.anchorProject
    ? `Como referência prática, destaco ${careerRules.anchorProject.trim().slice(0, 500)}\n\n`
    : "";
  const contractLine = contractSpecified === false
    ? "Gostaria também de confirmar se a contratação é no regime PJ ou CLT.\n\n"
    : "";
  const signature = applicantName?.trim() ? `\n\nAtenciosamente,\n${applicantName.trim()}` : "";
  return (
    `Olá, ${addressee}.\n\n` +
    `Gostaria de me candidatar à vaga de ${title}${jobReference}.\n\n` +
    positioningLine +
    seniorityLine +
    skillsLine +
    gapsLine +
    anchorLine +
    contractLine +
    "Tenho interesse em conversar para apresentar melhor minha experiência e entender os próximos passos do processo seletivo.\n\n" +
    "Fico à disposição para encaminhar meu currículo e demais informações necessárias." +
    signature
  );
}
