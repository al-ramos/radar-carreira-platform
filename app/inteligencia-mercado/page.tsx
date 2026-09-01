import type { Metadata } from "next";
import { requireChatGPTUser } from "../chatgpt-auth";
import MarketIntelligence from "./MarketIntelligence";

export const metadata: Metadata = {
  title: "Inteligência de Mercado | Radar Carreira",
  description: "Tendências, tecnologias e oportunidades consolidadas do Radar Carreira.",
};

export default async function MarketIntelligencePage() {
  await requireChatGPTUser("/inteligencia-mercado");
  return <MarketIntelligence />;
}
