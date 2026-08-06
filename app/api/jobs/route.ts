import { and, desc, eq, gte } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db/index";
import { jobs, profiles } from "../../../db/schema";
import { scoreJob } from "../../../lib/scoring";
import { inferTechnologyStack } from "../../../lib/technology-stack";

export const dynamic = "force-dynamic";
const parse = (value: string) => { try { return JSON.parse(value) as string[]; } catch { return []; } };

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 250);
    const period = url.searchParams.get("period") ?? "24";
    const hours = period === "all" ? null : Math.max(1, Math.min(Number(period) || 24, 24 * 30));
    const user = await getChatGPTUser();
    let profile: null | typeof profiles.$inferSelect = null;
    if (user) profile = (await getDb().select().from(profiles).where(eq(profiles.userId, user.userId)).limit(1))[0] ?? null;

    const cutoff = hours ? new Date(Date.now() - hours * 36e5) : null;
    const condition = cutoff ? and(eq(jobs.status, "active"), gte(jobs.publishedAt, cutoff)) : eq(jobs.status, "active");
    const rows = await getDb().select().from(jobs).where(condition).orderBy(desc(jobs.publishedAt)).limit(limit);
    const requiredStacks = profile ? parse(profile.requiredStacks) : [];
    const stackMatchMode = profile?.stackMatchMode === "any" ? "any" : "all";
    const result = rows.flatMap(job => {
      const stack = inferTechnologyStack(`${job.title} ${job.description}`,parse(job.stack));
      const normalizedStack = stack.map(value => value.toLocaleLowerCase("pt-BR"));
      const normalizedRequired = requiredStacks.map(value => value.toLocaleLowerCase("pt-BR")).filter(Boolean);
      const stackMatches = !normalizedRequired.length || (stackMatchMode === "all" ? normalizedRequired.every(value => normalizedStack.includes(value)) : normalizedRequired.some(value => normalizedStack.includes(value)));
      if(!stackMatches) return [];
      const match = profile ? scoreJob({title:job.title,description:job.description,stack,seniority:job.seniority,workMode:job.workMode,location:job.location,publishedAt:job.publishedAt},{masteredSkills:parse(profile.masteredSkills),desiredAreas:parse(profile.desiredAreas),avoidTerms:parse(profile.avoidTerms),seniority:profile.seniority,preferredMode:profile.preferredMode,cities:parse(profile.cities)}) : {score:70,reasons:["Complete seu perfil para personalizar"]};
      return [{...job,stack,score:match.score,reasons:match.reasons}];
    });
    return NextResponse.json({jobs:result,mode:"database",personalized:Boolean(profile),requiredStacks,stackMatchMode,period:period === "all" ? "all" : hours});
  } catch (error) {
    return NextResponse.json({jobs:[],mode:"unavailable",error:error instanceof Error?error.message:"Banco indisponível"},{status:503});
  }
}
