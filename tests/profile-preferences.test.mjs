import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { alexsandroProfilePreset, allowedWorkModes, listFromStored, normalizeCareerRules, normalizeMinScore } from "../lib/profile-options.ts";
import { isTechnologyJob, matchesSelectedSeniority, scoreJob } from "../lib/scoring.ts";
import { inferTechnologyStack } from "../lib/technology-stack.ts";
import { analyzeStackFit, computeVerdict } from "../lib/verdict.ts";

test("preserva preferências novas e legadas como listas", () => {
  assert.deepEqual(listFromStored('["C#", "SQL"]'), ["C#", "SQL"]);
  assert.deepEqual(listFromStored("Sênior, Pleno"), ["Sênior", "Pleno"]);
  assert.deepEqual(allowedWorkModes(["Remoto", "Híbrido", "Presencial"]), ["Remoto", "Híbrido", "Presencial"]);
});

test("preset de Alexsandro preserva posicionamento, projeto AMR e regras pessoais", () => {
  const preset = alexsandroProfilePreset();
  assert.equal(preset.careerRules.professionalName, "Alexsandro Ramos");
  assert.equal(preset.careerRules.professionalTitle, "Desenvolvedor .NET Pleno");
  assert.equal(preset.careerRules.baseLocation, "Mogi das Cruzes, SP");
  assert.deepEqual(preset.preferredMode, ["Remoto", "Híbrido"]);
  assert.deepEqual(preset.careerRules.acceptedRegions, ["Grande São Paulo"]);
  assert.equal(preset.careerRules.maxHybridDays, 2);
  assert.deepEqual(preset.careerRules.preferredContracts, ["PJ", "CLT"]);
  assert.deepEqual(preset.careerRules.dailyCommunicationLanguages, ["Português"]);
  assert.deepEqual(preset.careerRules.blockedSeniorities, ["Júnior", "Analista"]);
  assert.deepEqual(preset.careerRules.blockedWorkTypes, ["Sustentação", "Suporte"]);
  assert.deepEqual(preset.careerRules.coreStack, ["C#", ".NET"]);
  assert.deepEqual(preset.careerRules.stackExceptions, ["VBA + Access + SQL Server", "QA .NET"]);
  assert.match(preset.careerRules.anchorProject, /Sistema AMR/);
  assert.match(preset.careerRules.anchorProject, /CP\/ACID/);
  assert.match(preset.careerRules.anchorProject, /AP\/BASE/);
});

test("preserva score mínimo zero e limita valores ao intervalo permitido", () => {
  assert.equal(normalizeMinScore(0), 0);
  assert.equal(normalizeMinScore("75"), 75);
  assert.equal(normalizeMinScore(-1), 0);
  assert.equal(normalizeMinScore(101), 100);
  assert.equal(normalizeMinScore(""), 60);
  assert.equal(normalizeMinScore("inválido"), 60);
});

test("calcula aderência para mais de uma senioridade e modalidade", () => {
  const result = scoreJob(
    { title: "Engenheira de Software", description: "", stack: [], seniority: "Sênior", workMode: "Remoto" },
    { masteredSkills: [], desiredAreas: [], avoidTerms: [], seniority: ["Pleno", "Sênior"], preferredMode: ["Remoto"] },
  );
  assert.equal(result.score, 25);
  assert.deepEqual(result.reasons, ["Vaga de TI (+5)", "Senioridade compatível (+10)", "Modalidade preferida (+10)"]);
});

test("senioridades aceitas excluem vagas de outro nível e vagas sem nível", () => {
  assert.equal(matchesSelectedSeniority("Estágio", ["Estágio"]), true);
  assert.equal(matchesSelectedSeniority("Júnior", ["Estágio"]), false);
  assert.equal(matchesSelectedSeniority(null, ["Estágio"]), false);
  assert.equal(matchesSelectedSeniority(null, []), true);
});

test("valoriza a primeira família de stack sem punir um perfil amplo", () => {
  const profile = { masteredSkills: ["React", "Node.js", "R"], desiredAreas: [], avoidTerms: [], seniority: [], preferredMode: [] };
  const result = scoreJob({ title: "Pessoa desenvolvedora React", description: "Experiência com React.", stack: ["React"] }, profile);
  assert.equal(result.score, 40);
  assert.deepEqual(result.reasons, ["Vaga de TI (+5)", "✅ Stack compatível: React (+35)"]);
});

test("agrupa tecnologias equivalentes e aumenta o score ao encontrar outra família", () => {
  const profile = { masteredSkills: ["C#", ".NET", "SQL", "SQL Server", "MySQL", "PostgreSQL", "Oracle", "SQLite"], desiredAreas: [], avoidTerms: [], seniority: [], preferredMode: [] };
  const dotnet = scoreJob({ title: "Desenvolvedor .NET", description: "APIs em C#.", stack: ["C#", ".NET"] }, profile);
  assert.equal(dotnet.score, 40);
  assert.ok(dotnet.reasons.includes("✅ Stack compatível: .NET (+35)"));

  const dotnetAndSql = scoreJob({ title: "Desenvolvedor .NET", description: "APIs em C# com PostgreSQL.", stack: ["C#", ".NET", "PostgreSQL"] }, profile);
  assert.equal(dotnetAndSql.score, 55);
  assert.ok(dotnetAndSql.reasons.includes("✅ 2 famílias de stack compatíveis: .NET, Bancos relacionais (+50)"));
});

test("menção genérica a idioma não zera a vaga, mas exigência avançada bloqueia", () => {
  const profile = { masteredSkills: ["C#"], desiredAreas: [], avoidTerms: ["inglês", "espanhol"], seniority: [], preferredMode: [] };
  const mention = scoreJob({ title: "Desenvolvedor .NET", description: "Inglês desejável para leitura.", stack: ["C#"] }, profile);
  assert.equal(mention.score, 40);

  const required = scoreJob({ title: "Desenvolvedor .NET", description: "Inglês avançado obrigatório.", stack: ["C#"] }, profile);
  assert.deepEqual(required, { score: 0, reasons: ["Exige inglês avançado ou obrigatório"] });
});

test("reconhece variações semânticas da área de back-end", () => {
  const result = scoreJob(
    { title: "Backend Developer", description: "Construção de serviços.", stack: [] },
    { masteredSkills: [], desiredAreas: ["Desenvolvimento Back-end"], avoidTerms: [], seniority: [], preferredMode: [] },
  );
  assert.equal(result.score, 20);
  assert.ok(result.reasons.includes("Área desejada: Back-end (+15)"));
});

test("normaliza as regras estratégicas e protege o orçamento mensal de IA", () => {
  const rules = normalizeCareerRules({
    professionalTitle: "  Arquiteto de Soluções  ",
    maxHybridDays: 12,
    preferredContracts: ["PJ", "Freelancer"],
    dailyCommunicationLanguages: ["Português", "Espanhol"],
    aiMonthlyTokenLimit: -20,
  });
  assert.equal(rules.professionalTitle, "Arquiteto de Soluções");
  assert.equal(rules.maxHybridDays, 7);
  assert.deepEqual(rules.preferredContracts, ["PJ"]);
  assert.deepEqual(rules.dailyCommunicationLanguages, ["Português", "Espanhol"]);
  assert.equal(rules.aiMonthlyTokenLimit, 0);
});

test("aplica bloqueadores do perfil e respeita exceções de stack e idioma", () => {
  const baseRules = normalizeCareerRules({
    blockedWorkTypes: ["Sustentação"],
    stackExceptions: ["Arquitetura"],
    dailyCommunicationLanguages: ["Português", "Espanhol"],
  });
  const blocked = computeVerdict(
    { title: "Analista de Sustentação", description: "Rotina de sustentação em .NET", stack: ["C#", ".NET"] },
    ["C#"],
    baseRules,
  );
  assert.equal(blocked.emoji, "❌");
  assert.match(blocked.blocker ?? "", /Sustentação/);

  const exception = computeVerdict(
    { title: "Arquiteto LATAM", description: "Desarrollador em processo de postulación para projetos de arquitetura.", stack: ["Java"] },
    ["C#"],
    baseRules,
  );
  assert.notEqual(exception.blocker, "Vaga em espanhol (LATAM)");
  assert.notEqual(exception.blocker, "Stack incompatível com o perfil");
});

test("executa bloqueadores na ordem e não aceita vaga Java apenas porque também cita AWS", () => {
  const preset = alexsandroProfilePreset();
  const verdict = computeVerdict(
    { title: "Desenvolvedor Java Sênior", description: "Java, Spring e AWS. Inglês fluente obrigatório.", stack: ["Java", "Spring", "AWS"], seniority: "Sênior", workMode: "Remoto" },
    preset.masteredSkills,
    preset.careerRules,
  );
  assert.equal(verdict.emoji, "❌");
  assert.equal(verdict.blocker, "Stack incompatível com o perfil");
  assert.deepEqual(verdict.rows.map(row => row.criterion), ["Fase 1 · Stack"]);
});

test("reconhece automaticamente as exceções VBA/Access e QA .NET Sênior", () => {
  const preset = alexsandroProfilePreset();
  const legacy = computeVerdict(
    { title: "Desenvolvedor VBA", description: "Modernização com VBA, Microsoft Access e SQL Server.", stack: ["VBA", "Access", "SQL Server"], workMode: "Remoto" },
    preset.masteredSkills,
    preset.careerRules,
  );
  assert.notEqual(legacy.blocker, "Stack incompatível com o perfil");
  assert.match(legacy.rows[0].status, /Exceção automática: VBA \+ Access \+ SQL Server/);

  const qa = computeVerdict(
    { title: "QA .NET Sênior", description: "Automação de testes com Selenium, Playwright e xUnit no ecossistema .NET.", stack: ["Selenium", "Playwright"], seniority: "Sênior", workMode: "Remoto" },
    preset.masteredSkills,
    preset.careerRules,
  );
  assert.notEqual(qa.blocker, "Stack incompatível com o perfil");
  assert.match(qa.rows[0].status, /Exceção automática: QA \.NET Sênior/);
});

test("dá o mesmo poder de veto ao inglês e ao espanhol avançados", () => {
  const preset = alexsandroProfilePreset();
  for (const [requirement, expected] of [["Inglês fluente obrigatório para reuniões diárias", "Inglês avançado exigido"], ["Espanhol fluente obrigatório para reuniões diárias", "Espanhol avançado exigido"]]) {
    const verdict = computeVerdict(
      { title: "Desenvolvedor .NET Sênior", description: requirement, stack: ["C#", ".NET"], seniority: "Sênior", workMode: "Remoto" },
      preset.masteredSkills,
      preset.careerRules,
    );
    assert.equal(verdict.emoji, "❌");
    assert.equal(verdict.blocker, expected);
  }
});

test("entende Mogi como Grande São Paulo e aplica o limite do híbrido", () => {
  const preset = alexsandroProfilePreset();
  const light = computeVerdict(
    { title: "Desenvolvedor .NET Sênior", description: "Híbrido 2 dias por semana", stack: ["C#", ".NET"], seniority: "Sênior", workMode: "Híbrido", location: "Mogi das Cruzes, SP" },
    preset.masteredSkills,
    preset.careerRules,
  );
  assert.notEqual(light.emoji, "❌");
  assert.match(light.rows.find(row => row.criterion === "Fase 1 · Geografia")?.status ?? "", /região aceita/);

  const intense = computeVerdict(
    { title: "Desenvolvedor .NET Sênior", description: "Híbrido 3 dias por semana", stack: ["C#", ".NET"], seniority: "Sênior", workMode: "Híbrido", location: "Mogi das Cruzes, SP" },
    preset.masteredSkills,
    preset.careerRules,
  );
  assert.equal(intense.emoji, "❌");
  assert.match(intense.blocker ?? "", /limite do perfil/);

  const outside = computeVerdict(
    { title: "Desenvolvedor .NET Sênior", description: "Híbrido 1 dia por semana", stack: ["C#", ".NET"], seniority: "Sênior", workMode: "Híbrido", location: "Campinas, SP" },
    preset.masteredSkills,
    preset.careerRules,
  );
  assert.equal(outside.emoji, "❌");
  assert.match(outside.blocker ?? "", /fora das regiões aceitas/);
});

test("não confunde Pleno com Sênior na fase de preferências", () => {
  const preset = alexsandroProfilePreset();
  const verdict = computeVerdict(
    { title: "Desenvolvedor .NET Pleno", description: "Desenvolvimento de APIs", stack: ["C#", ".NET"], seniority: "Pleno", workMode: "Remoto" },
    preset.masteredSkills,
    preset.careerRules,
  );
  assert.equal(verdict.emoji, "🟡");
  assert.equal(verdict.label, "Provável com ressalvas");
  assert.match(verdict.rows.find(row => row.criterion === "Fase 1 · Senioridade")?.status ?? "", /Pleno/);
  assert.doesNotMatch(verdict.rows.find(row => row.criterion === "Fase 1 · Senioridade")?.status ?? "", /Sênior \/ equivalente/);
});

test("calcula recência quando o banco devolve a data como texto", () => {
  const result = scoreJob(
    { title: "Desenvolvedor de Software", description: "", stack: [], publishedAt: new Date().toISOString() },
    { masteredSkills: [], desiredAreas: [], avoidTerms: [], seniority: [], preferredMode: [] },
  );
  assert.equal(result.score, 10);
  assert.ok(result.reasons.includes("Publicada nas últimas 24h (+5)"));
});

test("explica com números quando a vaga não cita competências do perfil", () => {
  const result = scoreJob(
    { title: "Pessoa desenvolvedora Java", description: "Experiência com Spring.", stack: ["Java", "Spring"] },
    { masteredSkills: ["C#", ".NET"], desiredAreas: [], avoidTerms: [], seniority: [], preferredMode: [] },
  );
  assert.ok(result.reasons.includes("Nenhuma competência da vaga também está cadastrada em Competências dominadas do seu perfil (+0)"));
});

test("reproduz a vaga GCP sem inflar o score e remove tags duplicadas ou categóricas", () => {
  const stack = inferTechnologyStack("Engenheiro de Dados GCP Sênior", ["Google Cloud", "Dados / BI", "GCP"]);
  assert.deepEqual(stack, ["Google Cloud", "Dados / BI"]);
  const profile = {
    masteredSkills: ["C#", ".NET", "SQL", "SQL Server", "MySQL", "PostgreSQL", "Oracle", "SQLite"],
    desiredAreas: ["Visual Basic", "VB.Net", "vb.6", "Desenvolvimento Back-end"],
    avoidTerms: ["inglês", "espanhol"], seniority: [], preferredMode: [],
  };
  const result = scoreJob({ title: "Engenheiro de Dados GCP Sênior", description: "", stack, seniority: null, workMode: "Remoto", publishedAt: new Date() }, profile);
  assert.equal(result.score, 10);
  assert.deepEqual(analyzeStackFit(stack, profile.masteredSkills).missingSkills, ["Google Cloud"]);
  assert.deepEqual(analyzeStackFit(stack, ["GCP"]), { requiredSkills: ["Google Cloud"], matchingSkills: ["Google Cloud"], missingSkills: [] });
});

test("não pontua vaga fora do escopo de TI", () => {
  const job = { title: "Analista de Departamento Pessoal Sênior", description: "Rotinas de admissão e folha de pagamento.", stack: [] };
  const profile = { masteredSkills: ["React"], desiredAreas: ["Tecnologia"], avoidTerms: [], seniority: ["Sênior"], preferredMode: ["Remoto"] };
  assert.equal(isTechnologyJob(job), false);
  assert.deepEqual(scoreJob(job, profile), { score: 0, reasons: ["Vaga fora do escopo de TI — sem pontuação"] });
});

test("mostra como impedimento as stacks exigidas pela vaga que faltam no perfil", () => {
  const result = analyzeStackFit(["Python", "Google Cloud", "SQL"], ["C#", ".NET", "SQL Server"]);
  assert.deepEqual(result.matchingSkills, ["SQL"]);
  assert.deepEqual(result.missingSkills, ["Python", "Google Cloud"]);
});

test("perfil usa checkboxes e o radar expõe filtros de visualização", async () => {
  const [profile, dashboard, options] = await Promise.all([
    readFile(new URL("../app/ProfilePreferences.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/profile-options.ts", import.meta.url), "utf8"),
  ]);
  assert.match(profile, /type="checkbox"/);
  assert.match(profile, /<details className="profile-choice-field">/);
  assert.match(profile, /Selecionar todas/);
  assert.match(profile, /todas as competências de/);
  assert.match(profile, /toggleGroup/);
  assert.match(profile, /Limpar seleção/);
  assert.match(profile, /Competências dominadas/);
  assert.match(profile, /Todas as stacks selecionadas/);
  assert.match(profile, /Qualquer stack selecionada/);
  assert.match(profile, /role="dialog" aria-modal="true"/);
  assert.match(profile, /type="button" className="modal-close" onClick=\{onClose\}/);
  assert.doesNotMatch(profile, /className="modal-backdrop" onClick=\{onClose\}/);
  assert.match(profile, /Formato de trabalho/);
  assert.match(profile, /allowCustom=\{false\}/);
  assert.doesNotMatch(profile, /Cidades e regiões/);
  assert.match(profile, /SKILL_GROUPS/);
  assert.match(dashboard, /aria-label="Filtrar por estágio do pipeline"/);
  assert.match(dashboard, /className="pipeline-filter-select"/);
  assert.match(dashboard, /Importadas recentemente/);
  assert.match(dashboard, /params\.set\("sort", sortOrder === "recent" \? "imported" : "score"\)/);
  assert.match(dashboard, /useState<string \| null>\(null\)/);
  assert.match(dashboard, /data\.period/);
  assert.match(dashboard, /SENIORITY_OPTIONS/);
  assert.match(dashboard, /event\.key\s*===\s*"Escape"/);
  assert.match(dashboard, /const searchQuery = query\.trim\(\)\.toLowerCase\(\)/);
  assert.match(dashboard, /\(!searchQuery \|\| text\.includes\(searchQuery\)\)/);
  assert.doesNotMatch(dashboard, /j\.stack\.join\(" "\)\} \$\{j\.description/);
  assert.match(options, /Front-end e mobile/);
  assert.doesNotMatch(options, /Remoto - Brasil/);
  assert.match(options, /"Híbrido"/);
  assert.match(options, /Cloud e DevOps/);
  assert.match(options, /IA, analytics e BI/);
  assert.match(options, /Segurança/);
});
