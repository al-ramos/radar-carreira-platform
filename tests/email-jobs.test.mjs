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
