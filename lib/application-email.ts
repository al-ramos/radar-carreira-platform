type ApinfoApplicationEmailInput = {
  title: string;
  company: string;
  externalId?: string;
  matchingSkills: string[];
  seniority: string[];
  candidateName?: string | null;
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
  candidateName,
}: ApinfoApplicationEmailInput): string {
  const uniqueSkills = [...new Map(
    matchingSkills
      .map((skill) => skill.trim())
      .filter(Boolean)
      .map((skill) => [skill.toLocaleLowerCase("pt-BR"), skill]),
  ).values()].slice(0, 6);
  const addressee = company.trim() ? `equipe de recrutamento da ${company.trim()}` : "equipe de recrutamento";
  const jobReference = externalId ? ` (código ${externalId})` : "";
  const seniorityLine = seniority.length
    ? `Atuo em nível ${seniority.join("/")} e acredito que meu perfil esteja alinhado ao momento e às responsabilidades da posição.\n\n`
    : "";
  const skillsLine = uniqueSkills.length
    ? `Ao analisar a descrição, identifiquei boa aderência técnica, especialmente em ${uniqueSkills.join(", ")}. Essas competências fazem parte do meu perfil e se relacionam diretamente aos requisitos apresentados.\n\n`
    : "A descrição da oportunidade está alinhada à minha experiência profissional e ao tipo de posição que estou buscando.\n\n";
  const signature = candidateName?.trim() ? `\n\nAtenciosamente,\n${candidateName.trim()}` : "\n\nAtenciosamente,";

  return (
    `Olá, ${addressee}.\n\n` +
    `Gostaria de me candidatar à vaga de ${title}${jobReference}.\n\n` +
    seniorityLine +
    skillsLine +
    "Tenho interesse em conversar para apresentar melhor minha experiência e entender os próximos passos do processo seletivo." +
    signature
  );
}
