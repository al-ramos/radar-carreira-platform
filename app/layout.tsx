import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./platform.css";
import "./radar-refinement.css";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});
export const metadata:Metadata={title:"Radar Carreira | Seu próximo movimento",description:"Encontre as oportunidades certas e avance com clareza.",icons:{icon:"/radar-mark.svg"},openGraph:{title:"Radar Carreira | Seu próximo movimento",description:"Encontre as oportunidades certas e avance com clareza.",images:["/og.png"]},twitter:{card:"summary_large_image",title:"Radar Carreira | Seu próximo movimento",description:"Encontre as oportunidades certas e avance com clareza.",images:["/og.png"]}};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="pt-BR"><body className={geist.variable}>{children}</body></html>}
