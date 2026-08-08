import type { Metadata } from "next";
import Dashboard from "./Dashboard";
import { requireChatGPTUser } from "./chatgpt-auth";

export const metadata: Metadata = {
  title: "Radar Carreira Platform",
  description: "Vagas certas. Decisões melhores.",
};

export default async function Home() {
  await requireChatGPTUser("/");
  return <Dashboard />;
}
