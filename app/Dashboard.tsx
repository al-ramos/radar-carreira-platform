"use client";
import { useMemo, useState } from "react";

type Job = {id:string;score:number;title:string;company:string;location:string;mode:string;age:string;stack:string[];reasons:string[];stage:string};
const jobs: Job[] = [
 {id:"1",score:94,title:"Senior Cloud Security Engineer",company:"Nubank",location:"Brasil",mode:"Remoto",age:"2h",stack:["AWS","Terraform","Python"],reasons:["Stack aderente","Senioridade ideal","Remoto"],stage:"Nova"},
 {id:"2",score:89,title:"Security Operations Lead",company:"CloudWalk",location:"São Paulo",mode:"Híbrido",age:"4h",stack:["SIEM","SOC","Splunk"],reasons:["Área desejada","Liderança","Publicada hoje"],stage:"Nova"},
 {id:"3",score:84,title:"DevSecOps Engineer",company:"Stone",location:"Brasil",mode:"Remoto",age:"6h",stack:["Kubernetes","CI/CD","SAST"],reasons:["DevSecOps","Remoto","Boa aderência"],stage:"Salva"},
 {id:"4",score:78,title:"Cybersecurity Specialist",company:"Mercado Livre",location:"Osasco",mode:"Híbrido",age:"9h",stack:["IAM","Azure","GRC"],reasons:["Cybersecurity","Senior","Empresa-alvo"],stage:"Candidatura"},
 {id:"5",score:71,title:"Information Security Analyst",company:"PicPay",location:"São Paulo",mode:"Remoto",age:"12h",stack:["ISO 27001","Risk","LGPD"],reasons:["GRC","Remoto","Publicada hoje"],stage:"Nova"},
];
const nav=["Radar","Pipeline","Fontes","Importações","Configurações"];

export default function Dashboard(){
 const [active,setActive]=useState("Radar"),[query,setQuery]=useState(""),[selected,setSelected]=useState<Job>(jobs[0]),[minScore,setMinScore]=useState(70);
 const filtered=useMemo(()=>jobs.filter(j=>j.score>=minScore&&`${j.title} ${j.company} ${j.stack.join(" ")}`.toLowerCase().includes(query.toLowerCase())),[query,minScore]);
 return <main className="shell">
  <aside className="sidebar"><div className="brand"><span className="brand-mark">R</span><span>RADAR<br/><b>CARREIRA</b></span></div><nav>{nav.map((item,i)=><button key={item} className={active===item?"active":""} onClick={()=>setActive(item)}><span>{["⌁","▦","◉","↥","⚙"][i]}</span>{item}{item==="Importações"&&<em>ADMIN</em>}</button>)}</nav><div className="sidebar-foot"><div className="avatar">AR</div><div><strong>Almir Ramos</strong><small>Administrador</small></div><button>•••</button></div></aside>
  <section className="content"><header><div><p className="eyebrow">TERÇA-FEIRA, 4 DE AGOSTO</p><h1>{active==="Radar"?"Seu radar de hoje":active}</h1><p>Vagas coletadas nas últimas 24 horas, ordenadas pela sua aderência.</p></div><div className="header-actions"><button className="icon-btn">◌</button><button className="primary">＋ Importar vagas</button></div></header>
   <div className="metrics"><article><span>VAGAS NOVAS</span><strong>47</strong><small>↑ 12 desde ontem</small></article><article><span>ADERÊNCIA ALTA</span><strong>18</strong><small>Score acima de 80</small></article><article><span>NO PIPELINE</span><strong>7</strong><small>3 em processo</small></article><article className="accent"><span>MELHOR MATCH</span><strong>94%</strong><small>Nubank · há 2 horas</small></article></div>
   <div className="toolbar"><div className="search">⌕<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar cargo, empresa ou tecnologia"/></div><select onChange={e=>setMinScore(Number(e.target.value))} value={minScore}><option value="0">Todos os scores</option><option value="70">Score 70+</option><option value="80">Score 80+</option></select><button className="filter">⚙ Filtros <b>3</b></button></div>
   <div className="workspace"><div className="job-list"><div className="list-head"><span>{filtered.length} melhores oportunidades</span><button>Mais recentes ▾</button></div>{filtered.map(j=><button key={j.id} className={`job-card ${selected.id===j.id?"selected":""}`} onClick={()=>setSelected(j)}><div className="score">{j.score}<small>match</small></div><div className="job-main"><div><small>{j.company.toUpperCase()}</small><h3>{j.title}</h3></div><p>⌖ {j.location} · {j.mode} <span>· {j.age}</span></p><div className="tags">{j.stack.map(t=><span key={t}>{t}</span>)}</div></div><span className="bookmark">♡</span></button>)}</div>
    <aside className="detail"><div className="detail-top"><span className="company-logo">{selected.company[0]}</span><button>♡</button><button>⋯</button></div><small>{selected.company.toUpperCase()}</small><h2>{selected.title}</h2><p>⌖ {selected.location} · {selected.mode} · publicada há {selected.age}</p><div className="match"><div><strong>{selected.score}%</strong><span>aderência ao seu perfil</span></div><div className="bar"><i style={{width:`${selected.score}%`}}/></div></div><h4>POR QUE É UM BOM MATCH</h4><ul>{selected.reasons.map(r=><li key={r}>✓ {r}</li>)}</ul><h4>TECNOLOGIAS</h4><div className="tags large">{selected.stack.map(t=><span key={t}>{t}</span>)}</div><h4>RESUMO DA VAGA</h4><p className="summary">Atuação em segurança e infraestrutura cloud, colaborando com times de engenharia para elevar a maturidade, automatizar controles e reduzir riscos.</p><div className="detail-actions"><button>Salvar</button><button className="primary">Ver vaga ↗</button></div></aside>
   </div>
  </section>
 </main>;
}
