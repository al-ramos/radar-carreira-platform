import assert from "node:assert/strict";
import test from "node:test";
import { applicationFromEmail, jobsFromEmail } from "../lib/email-jobs.ts";

test("alerta do LinkedIn preserva cargo, empresa e localização", () => {
  const [job] = jobsFromEmail({
    id:"mail-1",
    from:"Vagas do LinkedIn <jobs-noreply@linkedin.com>",
    subject:"Novas vagas para você",
    date:"2026-08-05T11:00:00.000Z",
    body:"Desenvolvedor de back end\n\nGrupo Iter\nRio de Janeiro, Brasil\nCandidate-se com currículo e perfil\nVisualizar vaga: https://www.linkedin.com/jobs/view/1234567890/",
  });
  assert.equal(job.title,"Desenvolvedor de back end");
  assert.equal(job.company,"Grupo Iter");
  assert.equal(job.location,"Rio de Janeiro, Brasil");
});

test("alerta 'Importada do alerta RadarVagas' não troca título/empresa/local por selos do LinkedIn nem herda o assunto de um aviso de candidatura", () => {
  const jobs = jobsFromEmail({
    id: "mail-3",
    from: "Vagas do LinkedIn <jobs-noreply@linkedin.com>",
    subject: "Alex, candidate-se agora à vaga de Desenvolvedor(a) Back-end Sênior (.NET) na Blite Tecnologia",
    date: "2026-09-03T11:00:00.000Z",
    body: [
      "Desenvolvedor(a) Back-end Sênior (.NET)",
      "Blite Tecnologia",
      "São Paulo, São Paulo, Brasil",
      "7 ex-alunos da instituição de ensino",
      "Candidate-se com currículo e perfil",
      "Visualizar vaga: https://www.linkedin.com/jobs/view/4445259569/",
      "",
      "São Paulo, SP",
      "3 conexões",
      "41 ex-alunos da instituição de ensino",
      "Visualizar vaga: https://www.linkedin.com/jobs/view/4416936572/",
    ].join("\n"),
  });

  // O selo "N ex-alunos da instituição de ensino" não deve ser lido como
  // localização, nem empurrar o título real para fora da janela extraída.
  assert.equal(jobs.length, 1);
  const [job] = jobs;
  assert.equal(job.title, "Desenvolvedor(a) Back-end Sênior (.NET)");
  assert.equal(job.company, "Blite Tecnologia");
  assert.equal(job.location, "São Paulo, São Paulo, Brasil");
  // A descrição não pode reaproveitar o assunto do e-mail (um aviso de
  // candidatura sem relação com a vaga do bloco) — ela é montada a partir
  // dos próprios campos extraídos.
  assert.equal(job.description, "Importada do alerta RadarVagas: vaga de Desenvolvedor(a) Back-end Sênior (.NET) na Blite Tecnologia (LinkedIn).");
  assert.ok(!job.description.includes("candidate-se agora"));

  // O segundo bloco não tem título/empresa/local extraíveis com confiança
  // (título real, empresa e local foram substituídos por metadados de
  // interface) e por isso deve ser descartado em vez de virar uma vaga com
  // campos trocados.
});

test("confirmações do LinkedIn identificam candidatura já enviada", () => {
  const signal = applicationFromEmail({
    id: "mail-2",
    from: "LinkedIn <jobs-noreply@linkedin.com>",
    subject: "Sua candidatura a Desenvolvedor(a) de .NET sênior na BRQ Digital Solutions",
    date: "2026-08-24T12:00:00.000Z",
    body: "",
  });
  assert.deepEqual(signal, {
    title: "Desenvolvedor(a) de .NET sênior",
    company: "BRQ Digital Solutions",
    stage: "applied",
    type: "application_sent",
    detail: "Sua candidatura a Desenvolvedor(a) de .NET sênior na BRQ Digital Solutions",
  });
});
