import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import "./platform.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});
export const metadata:Metadata={title:"Radar Carreira Platform",description:"Vagas certas. Decisões melhores.",icons:{icon:"/favicon.svg"},openGraph:{title:"Radar Carreira Platform",description:"Vagas certas. Decisões melhores.",images:["/og.png"]},twitter:{card:"summary_large_image",title:"Radar Carreira Platform",description:"Vagas certas. Decisões melhores.",images:["/og.png"]}};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="pt-BR"><body className={geist.variable}>{children}</body></html>}
