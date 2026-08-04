import type { Metadata } from "next";
import "./globals.css";
import "./platform.css";
export const metadata:Metadata={title:"Radar Carreira Platform",description:"Vagas certas. Decisões melhores.",icons:{icon:"/favicon.svg"},openGraph:{title:"Radar Carreira Platform",description:"Vagas certas. Decisões melhores.",images:["/og.png"]},twitter:{card:"summary_large_image",title:"Radar Carreira Platform",description:"Vagas certas. Decisões melhores.",images:["/og.png"]}};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="pt-BR"><body>{children}</body></html>}
