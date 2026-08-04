"use client";
import { useEffect,useState } from "react";
type Settings={collectionEnabled:boolean;emailImportEnabled:boolean;enrichmentEnabled:boolean;defaultPeriod:string;defaultMinScore:number;staleAfterDays:number;retentionDays:number};
const initial:Settings={collectionEnabled:true,emailImportEnabled:true,enrichmentEnabled:true,defaultPeriod:"24",defaultMinScore:70,staleAfterDays:7,retentionDays:180};
export default function AdminSettings(){
 const[s,setS]=useState(initial),[status,setStatus]=useState("Carregando parâmetros…");
 useEffect(()=>{fetch("/api/admin/settings").then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);setS(d.settings);setStatus("")}).catch(()=>setStatus("Não foi possível carregar os parâmetros."))},[]);
 const toggle=(key:keyof Settings)=>(e:React.ChangeEvent<HTMLInputElement>)=>setS({...s,[key]:e.target.checked});
 async function save(){setStatus("Salvando…");const r=await fetch("/api/admin/settings",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(s)});setStatus(r.ok?"Parâmetros salvos e ativos.":"Não foi possível salvar.")}
 return <section className="admin-settings"><div className="admin-heading"><div><p className="eyebrow">ADMINISTRAÇÃO DO PORTAL</p><h3>Parâmetros operacionais</h3></div><span>Somente admin</span></div><div className="switch-grid">
 <label><input type="checkbox" checked={s.collectionEnabled} onChange={toggle("collectionEnabled")}/><span><b>Coleta automática</b><small>Autoriza a rotina diária das fontes.</small></span></label>
 <label><input type="checkbox" checked={s.emailImportEnabled} onChange={toggle("emailImportEnabled")}/><span><b>Importação por e-mail</b><small>Recebe alertas do conector Gmail.</small></span></label>
 <label><input type="checkbox" checked={s.enrichmentEnabled} onChange={toggle("enrichmentEnabled")}/><span><b>Enriquecimento oficial</b><small>Completa descrições por fontes monitoradas.</small></span></label></div>
 <div className="profile-grid admin-number-grid"><label>Janela inicial<select value={s.defaultPeriod} onChange={e=>setS({...s,defaultPeriod:e.target.value})}><option value="24">Últimas 24 horas</option><option value="72">Últimos 3 dias</option><option value="168">Últimos 7 dias</option><option value="all">Todas</option></select></label><label>Score padrão<input type="number" min="0" max="100" value={s.defaultMinScore} onChange={e=>setS({...s,defaultMinScore:Number(e.target.value)})}/></label><label>Vaga desatualizada após<input type="number" min="1" max="90" value={s.staleAfterDays} onChange={e=>setS({...s,staleAfterDays:Number(e.target.value)})}/></label><label>Retenção do histórico<input type="number" min="30" max="1095" value={s.retentionDays} onChange={e=>setS({...s,retentionDays:Number(e.target.value)})}/></label></div>
 {status&&<div className="notice">{status}</div>}<div className="source-actions"><button className="primary" onClick={save}>Salvar parâmetros</button></div></section>
}
