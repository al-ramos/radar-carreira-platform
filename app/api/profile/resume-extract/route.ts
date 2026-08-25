import { and, eq, gte, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getDb } from "../../../../db/index";
import { aiUsageEvents, profiles } from "../../../../db/schema";
import { extractStructuredResumeFacts, getAiProviderStatus } from "../../../../lib/ai-provider";
import { normalizeCareerRules } from "../../../../lib/profile-options";
import { extractKnownSkills, extractTextFromPdf, normalizeResumeSkill, redactResumeContacts, ResumeProposal } from "../../../../lib/resume-import";
import { getChatGPTUser } from "../../../chatgpt-auth";

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

function proposalFromLocal(text: string, pageCount: number): ResumeProposal {
  const skills = extractKnownSkills(text);
  return { skills, coreStackCandidates: [], professionalSummary: "", source: "local", pageCount, textCharacters: text.length };
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("resume");
  if (!(file instanceof File)) return NextResponse.json({ error: "Selecione um currículo em PDF." }, { status: 400 });
  if (file.size === 0 || file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "O PDF deve ter até 10 MB." }, { status: 400 });
  if (file.type && file.type !== "application/pdf") return NextResponse.json({ error: "Envie um arquivo no formato PDF." }, { status: 400 });

  try {
    const { text, pageCount } = await extractTextFromPdf(await file.arrayBuffer());
    const redactedText = redactResumeContacts(text);
    const fallback = proposalFromLocal(text, pageCount);
    const status = getAiProviderStatus();
    if (!status.configured) return NextResponse.json({ proposal: fallback, warning: "A IA não está configurada; identificamos somente tecnologias conhecidas encontradas no texto." });

    const db = getDb();
    const profile = (await db.select({ careerRules: profiles.careerRules }).from(profiles).where(eq(profiles.userId, user.userId)).limit(1))[0];
    const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
    const used = await db.select({ total: sql<number>`coalesce(sum(${aiUsageEvents.inputTokens} + ${aiUsageEvents.outputTokens}), 0)` }).from(aiUsageEvents).where(and(eq(aiUsageEvents.userId, user.userId), gte(aiUsageEvents.createdAt, monthStart))).then(rows => Number(rows[0]?.total ?? 0));
    const tokenLimit = normalizeCareerRules(profile?.careerRules).aiMonthlyTokenLimit;
    const estimate = Math.ceil(redactedText.length / 4) + 1_400;
    if (used + estimate > tokenLimit) {
      await db.insert(aiUsageEvents).values({ id: randomUUID(), userId: user.userId, operation: "extract_resume", provider: status.provider ?? "unknown", model: status.model ?? "unknown", status: "blocked_budget", createdAt: new Date() });
      return NextResponse.json({ proposal: fallback, warning: "O limite mensal de IA foi atingido; identificamos somente tecnologias conhecidas encontradas no texto." });
    }

    try {
      const completion = await extractStructuredResumeFacts(redactedText);
      const skillsByName = new Map(fallback.skills.map(skill => [skill.name.toLocaleLowerCase("pt-BR"), skill]));
      for (const skill of completion.value.skills) {
        const name = normalizeResumeSkill(skill.name);
        if (!name || !redactedText.toLocaleLowerCase("pt-BR").includes(skill.evidence.toLocaleLowerCase("pt-BR"))) continue;
        const key = name.toLocaleLowerCase("pt-BR");
        const current = skillsByName.get(key);
        if (!current || skill.confidence > current.confidence) skillsByName.set(key, { name, confidence: skill.confidence, evidence: skill.evidence });
      }
      const skills = [...skillsByName.values()].sort((left, right) => right.confidence - left.confidence || left.name.localeCompare(right.name, "pt-BR")).slice(0, 80);
      const available = new Set(skills.map(skill => skill.name.toLocaleLowerCase("pt-BR")));
      const coreStackCandidates = completion.value.coreStackCandidates.map(normalizeResumeSkill).filter((name, index, values) => name && available.has(name.toLocaleLowerCase("pt-BR")) && values.indexOf(name) === index).slice(0, 5);
      await db.insert(aiUsageEvents).values({ id: randomUUID(), userId: user.userId, operation: "extract_resume", provider: completion.provider, model: completion.model, inputTokens: completion.inputTokens, outputTokens: completion.outputTokens, status: "completed", createdAt: new Date() });
      return NextResponse.json({ proposal: { skills, coreStackCandidates, professionalSummary: completion.value.professionalSummary, source: "ai", pageCount, textCharacters: text.length } satisfies ResumeProposal });
    } catch (error) {
      await db.insert(aiUsageEvents).values({ id: randomUUID(), userId: user.userId, operation: "extract_resume", provider: status.provider ?? "unknown", model: status.model ?? "unknown", status: "failed", createdAt: new Date() });
      console.error("resume_extract_failed", error);
      return NextResponse.json({ proposal: fallback, warning: "A leitura inteligente não ficou disponível; identificamos somente tecnologias conhecidas encontradas no texto." });
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Não foi possível ler este currículo.";
    return NextResponse.json({ error: detail }, { status: 422 });
  }
}
