import assert from "node:assert/strict";
import test from "node:test";
import { jobsFromEmail } from "../lib/email-jobs.ts";

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
