import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { requireChatGPTUser } from "../chatgpt-auth";
import { getDb } from "../../db/index";
import { profiles } from "../../db/schema";
import OnboardingFlow from "../OnboardingFlow";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Configure seu radar — Radar Carreira Platform",
  description: "Vagas certas. Decisões melhores.",
};

export default async function OnboardingPage() {
  const user = await requireChatGPTUser("/onboarding");
  const existing = (await getDb().select().from(profiles).where(eq(profiles.userId, user.userId)).limit(1))[0];
  if (existing?.seniority) redirect("/");

  const firstName = (user.fullName ?? "").split(" ")[0] || "por aqui";
  return <OnboardingFlow firstName={firstName} />;
}
