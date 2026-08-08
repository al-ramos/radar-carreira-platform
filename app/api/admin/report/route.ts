import { and, desc, eq, gte, like, notLike } from "drizzle-orm";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { jobs, jobSources, profiles, userJobStatus } from "../../../../db/schema";
import { scoreJob } from "../../../../lib/scoring";
import { computeVerdict, type VerdictEmoji } from "../../../../lib/verdict";
import { inferTechnologyStack } from "../../../../lib/technology-stack";
import { allowedWorkModes, listFromStored } from "../../../../lib/profile-options";

export const dynamic = "force-dynamic";
const csv = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""').replace(/[\r\n]+/g, " ")}"`;
const isLinkedInUrl = (url: string) => /linkedin\.com/i.test(url);

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Autenticação necessária" }, { status: 401 });
  const db = getDb();
  const url = new URL(request.url);

  // Mesmos filtros disponíveis no painel: período, fonte, busca livre,
  // score mínimo, etapa do pipeline e veredito — o relatório deve refletir
  // exatamente o que está sendo exibido na tela no momento do download.
  const period = url.searchParams.get("period") ?? "24";
  const sourceType = url.searchParams.get("sourceType") ?? "all"; // all | linkedin | other
  const searchQuery = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const minScoreParam = url.searchParams.get("minScore");
  const minScore = minScoreParam !== null && Number.isFinite(Number(minScoreParam)) ? Number(minScoreParam) : 0;
  const pipelineFilter = url.searchParams.get("pipeline") ?? "all"; // all | unseen | viewed | saved | applied | interview | rejected | archived
  const verdictFilter = url.searchParams.get("verdict") ?? "all"; // all | ✅ | 🟡 | 🔴 | ❌

  const hours = period === "all" ? null : Math.max(1, Math.min(Number(period) || 24, 720));
  const cutoff = hours ? new Date(Date.now() - hours * 36e5) : null;
  const baseCondition = cutoff ? and(eq(jobs.status, "active"), gte(jobs.publishedAt, cutoff)) : eq(jobs.status, "active");
  const condition =
    sourceType === "linkedin"
      ? and(baseCondition, like(jobs.url, "%linkedin.com%"))
      : sourceType === "other"
        ? and(baseCondition, notLike(jobs.url, "%linkedin.com%"))
        : baseCondition;

  const [rows, pipeline, profileRows] = await Promise.all([
    db.select({ job: jobs, source: jobSources.name }).from(jobs).leftJoin(jobSources, eq(jobs.sourceId, jobSources.id)).where(condition).orderBy(desc(jobs.publishedAt)),
    db.select().from(userJobStatus).where(eq(userJobStatus.userId, user.userId)),
    db.select().from(profiles).where(eq(profiles.userId, user.userId)).limit(1),
  ]);
  const byJob = new Map(pipeline.map((item) => [item.jobId, item]));
  const profile = profileRows[0] ?? null;
  const masteredSkills = profile ? listFromStored(profile.masteredSkills) : [];
  const selectedSeniority = profile ? listFromStored(profile.seniority) : [];
  const scoreProfile = profile
    ? {
        masteredSkills,
        desiredAreas: listFromStored(profile.desiredAreas),
        avoidTerms: listFromStored(profile.avoidTerms),
        seniority: selectedSeniority,
        preferredMode: allowedWorkModes(profile.preferredMode),
      }
    : null;

  const header = ["Data da coleta", "Data de publicação", "Fonte", "Cargo", "Empresa", "Localização", "Modalidade", "Senioridade", "Tecnologias", "Descrição detalhada", "Link", "Status", "Score", "Veredito", "Etapa do pipeline", "Observações"];
  const lines = rows
    .filter(({ job }) => {
      const state = byJob.get(job.id);
      const text = `${job.title} ${job.company} ${job.location ?? ""} ${job.seniority ?? ""}`.toLowerCase();
      const stageMatches =
        pipelineFilter === "all" ||
        (pipelineFilter === "unseen" ? !state : state?.stage === pipelineFilter);
      if (!stageMatches) return false;
      if (searchQuery && !text.includes(searchQuery)) return false;
      if (sourceType === "linkedin" && !isLinkedInUrl(job.url)) return false;
      if (sourceType === "other" && isLinkedInUrl(job.url)) return false;
      return true;
    })
    .map(({ job, source }) => {
      const state = byJob.get(job.id);
      const stack = inferTechnologyStack(`${job.title} ${job.description}`, JSON.parse(job.stack || "[]"));
      const score = scoreProfile
        ? scoreJob({ title: job.title, description: job.description, stack, seniority: job.seniority, workMode: job.workMode, location: job.location, publishedAt: job.publishedAt }, scoreProfile).score
        : null;
      const verdict = masteredSkills.length > 0
        ? computeVerdict({ title: job.title, description: job.description, stack, seniority: job.seniority, workMode: job.workMode }, masteredSkills).emoji
        : null;
      return { job, source, state, score, verdict, stack };
    })
    .filter(({ score }) => score === null || score >= minScore)
    .filter(({ verdict }) => verdictFilter === "all" || (verdictFilter as VerdictEmoji) === verdict)
    .map(({ job, source, state, score, verdict, stack }) =>
      [job.firstSeenAt.toISOString(), job.publishedAt?.toISOString() ?? "", source ?? "Importação manual", job.title, job.company, job.location, job.workMode, job.seniority, stack.join(", "), job.description, job.url, job.status, score ?? "", verdict ?? "", state?.stage ?? "new", state?.note ?? ""].map(csv).join(";"),
    );
  const body = `﻿${header.map(csv).join(";")}\r\n${lines.join("\r\n")}`;
  return new Response(body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="radar-vagas-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "no-store" } });
}
