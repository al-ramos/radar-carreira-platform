import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "../../../db/index";
import { profiles } from "../../../db/schema";
import { allowedWorkModes, listFromStored, normalizeCareerRules, normalizeMinScore } from "../../../lib/profile-options";
import { getChatGPTUser } from "../../chatgpt-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ user: null }, { status: 401 });
  const db = getDb();
  let profile = (await db.select().from(profiles).where(eq(profiles.userId, user.userId)).limit(1))[0];
  if (!profile) {
    profile = { userId: user.userId, email: user.email, name: user.fullName, role: "user", seniority: null, preferredMode: null, cities: "[]", masteredSkills: "[]", desiredAreas: "[]", avoidTerms: "[]", minScore: 60, careerRules: "{}", updatedAt: new Date() };
    await db.insert(profiles).values(profile);
  }
  return NextResponse.json({ user: { ...user, role: profile.role }, profile: { ...profile, seniority: listFromStored(profile.seniority), preferredMode: allowedWorkModes(profile.preferredMode), masteredSkills: listFromStored(profile.masteredSkills), desiredAreas: listFromStored(profile.desiredAreas), avoidTerms: listFromStored(profile.avoidTerms), careerRules: normalizeCareerRules(profile.careerRules) } });
}

export async function PUT(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });
  const db = getDb();
  const existing = (await db.select({ role: profiles.role }).from(profiles).where(eq(profiles.userId, user.userId)).limit(1))[0];
  const body = await request.json() as Record<string, unknown>;
  const storedList = (key: string) => JSON.stringify(listFromStored(body[key]));
  const score = normalizeMinScore(body.minScore);
  const careerRules = normalizeCareerRules(body.careerRules);
  const values = {
    userId: user.userId, email: user.email, name: user.fullName,
    role: existing?.role ?? "user" as const,
    seniority: storedList("seniority"), preferredMode: JSON.stringify(allowedWorkModes(body.preferredMode)), cities: "[]",
    masteredSkills: storedList("masteredSkills"), desiredAreas: storedList("desiredAreas"), avoidTerms: storedList("avoidTerms"),
    minScore: score, careerRules: JSON.stringify(careerRules), updatedAt: new Date(),
  };
  await db.insert(profiles).values(values).onConflictDoUpdate({ target: profiles.userId, set: values });
  return NextResponse.json({ ok: true, profile: { minScore: score, careerRules } });
}
