"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { scoreJob } from "../lib/scoring";

type ApiJob = {
  id: string; title: string; company: string; location?: string; workMode?: string;
  seniority?: string; publishedAt?: string; stack?: string[]; description?: string; url?: string;
};

const SENIORITY = ["Estágio", "Júnior", "Pleno", "Sênior", "Especialista", "Liderança"];
const MODES = ["Remoto", "Híbrido", "Presencial"];
const AREA_SUGGESTIONS = ["Cloud Security", "Cybersecurity", "DevSecOps", "Security Operations", "Backend", "Dados", "Produto", "Frontend"];
const SKILL_SUGGESTIONS = ["AWS", "Azure", "GCP", "Terraform", "Python", "Kubernetes", "SIEM", "SOC", "IAM", "GRC", "CI/CD", "Node.js"];
const AVOID_SUGGESTIONS = ["Estágio", "Trainee", "Júnior", "PJ"];

function ChipField({ label, values, suggestions, onAdd, onRemove }: {
  label: string; values: string[]; suggestions: string[];
  onAdd: (v: string) => void; onRemove: (v: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const remaining = suggestions.filter(s => !values.includes(s));
  const commit = () => { const v = draft.trim(); if (v) { onAdd(v); setDraft(""); } };
  return (
    <div className="onboarding-field">
      <label>{label}</label>
      <div className="onboarding-chip-row">
        {values.map(v => <button key={v} type="button" className="chip chip-on" onClick={() => onRemove(v)}>{v} ✕</button>)}
        {values.length === 0 && <span style={{ fontSize: 12, color: "#7b857e" }}>Nenhuma selecionada ainda.</span>}
      </div>
      {remaining.length > 0 && (
        <div className="onboarding-chip-row">
          {remaining.map(v => <button key={v} type="button" className="chip chip-off" onClick={() => onAdd(v)}>+ {v}</button>)}
        </div>
      )}
      <div className="onboarding-add">
        <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="Adicionar outra…"
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commit(); } }} />
        <button type="button" onClick={commit}>+</button>
      </div>
    </div>
  );
}

export default function OnboardingFlow({ firstName }: { firstName: string }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [seniority, setSeniority] = useState("Pleno");
  const [preferredMode, setPreferredMode] = useState("Remoto");
  const [cities, setCities] = useState<string[]>(["São Paulo"]);
  const [desiredAreas, setDesiredAreas] = useState<string[]>([]);
  const [masteredSkills, setMasteredSkills] = useState<string[]>([]);
  const [avoidTerms, setAvoidTerms] = useState<string[]>([]);
  const [minScore, setMinScore] = useState(60);
  const [jobs, setJobs] = useState<ApiJob[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/profile").then(r => r.ok ? r.json() : null).then(d => {
      const p = d?.profile;
      if (!p) return;
      if (p.seniority) setSeniority(p.seniority);
      if (p.preferredMode) setPreferredMode(p.preferredMode);
      if (p.cities?.length) setCities(p.cities);
      if (p.desiredAreas?.length) setDesiredAreas(p.desiredAreas);
      if (p.masteredSkills?.length) setMasteredSkills(p.masteredSkills);
      if (p.avoidTerms?.length) setAvoidTerms(p.avoidTerms);
      if (p.minScore) setMinScore(p.minScore);
    }).catch(() => {});
    fetch("/api/jobs?limit=100&period=all&all=1").then(r => r.ok ? r.json() : { jobs: [] }).then(d => setJobs(d.jobs ?? [])).catch(() => {});
  }, []);

  const scored = useMemo(() => {
    const profile = { masteredSkills, desiredAreas, avoidTerms, seniority, preferredMode, cities };
    return jobs.map(job => {
      const input = {
        title: job.title, description: job.description ?? "", stack: job.stack ?? [],
        seniority: job.seniority ?? null, workMode: job.workMode ?? null, location: job.location ?? null,
        publishedAt: job.publishedAt ? new Date(job.publishedAt) : null,
      };
      const result = scoreJob(input, profile);
      return { ...job, score: result.score, reasons: result.reasons };
    }).filter(j => j.reasons[0] !== "Contém termo bloqueado").sort((a, b) => b.score - a.score).slice(0, 4);
  }, [jobs, masteredSkills, desiredAreas, avoidTerms, seniority, preferredMode, cities]);

  async function persist() {
    setSaving(true);
    setMessage("Salvando…");
    try {
      const r = await fetch("/api/profile", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ seniority, preferredMode, cities, masteredSkills, desiredAreas, avoidTerms, minScore }),
      });
      if (!r.ok) throw new Error();
      router.push("/");
    } catch {
      setMessage("Não foi possível salvar. Tente novamente.");
      setSaving(false);
    }
  }

  const scoreLabel = minScore <= 30 ? "Mostra quase todas as vagas ativas."
    : minScore <= 60 ? "Equilíbrio entre quantidade e qualidade."
    : minScore <= 80 ? "Só as vagas com boa aderência."
    : "Apenas os matches mais fortes.";

  return (
    <div className="onboarding">
      <div className="onboarding-card">
        {step > 0 && (
          <div className="onboarding-progress">
            <span>PASSO {step} DE 4</span>
            <div className="track"><i style={{ width: `${step * 25}%` }} /></div>
            <button type="button" className="onboarding-skip" onClick={persist}>Pular por enquanto</button>
          </div>
        )}

        {step === 0 && (
          <div>
            <p className="eyebrow">OLÁ, {firstName.toUpperCase()}</p>
            <h1>Vagas certas.<br />Decisões melhores.</h1>
            <p className="onboarding-sub">O Radar de Carreira acompanha vagas de várias empresas o dia inteiro, calcula o quanto cada uma combina com o seu perfil e organiza suas candidaturas do início ao fim.</p>
            <div className="onboarding-features">
              <div><span className="ico">◉</span><strong>Score personalizado</strong><small>Cada vaga ganha uma nota de aderência.</small></div>
              <div><span className="ico">↥</span><strong>Coleta automática</strong><small>Vagas novas chegam sozinhas, todo dia útil.</small></div>
              <div><span className="ico">▦</span><strong>Pipeline organizado</strong><small>Candidatura, entrevista e proposta.</small></div>
            </div>
            <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" className="primary" onClick={() => setStep(1)}>Vamos montar seu radar →</button>
              <button type="button" className="onboarding-skip" onClick={persist}>Pular por enquanto</button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div>
            <h2>Fale um pouco sobre você</h2>
            <p className="onboarding-sub">Isso ajuda a calibrar sua senioridade e onde faz sentido procurar vagas.</p>
            <div className="onboarding-field">
              <label>Senioridade</label>
              <div className="onboarding-chip-row">
                {SENIORITY.map(s => <button key={s} type="button" className={`chip ${seniority === s ? "chip-on" : "chip-off"}`} onClick={() => setSeniority(s)}>{s}</button>)}
              </div>
            </div>
            <div className="onboarding-field">
              <label>Modalidade preferida</label>
              <div className="onboarding-seg">
                {MODES.map(m => <button key={m} type="button" className={preferredMode === m ? "on" : ""} onClick={() => setPreferredMode(m)}>{m}</button>)}
              </div>
            </div>
            <ChipField label="Cidades de interesse" values={cities} suggestions={[]}
              onAdd={v => setCities(c => c.includes(v) ? c : [...c, v])}
              onRemove={v => setCities(c => c.filter(x => x !== v))} />
            <div className="onboarding-nav">
              <button type="button" className="icon-btn" onClick={() => setStep(0)}>Voltar</button>
              <button type="button" className="primary" onClick={() => setStep(2)}>Continuar →</button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <h2>O que você está buscando?</h2>
            <p className="onboarding-sub">Selecione as áreas e competências que mais combinam com você — isso define o score de cada vaga.</p>
            <ChipField label="Áreas desejadas" values={desiredAreas} suggestions={AREA_SUGGESTIONS}
              onAdd={v => setDesiredAreas(a => a.includes(v) ? a : [...a, v])}
              onRemove={v => setDesiredAreas(a => a.filter(x => x !== v))} />
            <ChipField label="Competências dominadas" values={masteredSkills} suggestions={SKILL_SUGGESTIONS}
              onAdd={v => setMasteredSkills(a => a.includes(v) ? a : [...a, v])}
              onRemove={v => setMasteredSkills(a => a.filter(x => x !== v))} />
            <div className="onboarding-nav">
              <button type="button" className="icon-btn" onClick={() => setStep(1)}>Voltar</button>
              <button type="button" className="primary" onClick={() => setStep(3)}>Continuar →</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <h2>Últimos ajustes</h2>
            <p className="onboarding-sub">Um filtro fino para o radar não te mostrar o que não interessa.</p>
            <ChipField label="Termos a evitar" values={avoidTerms} suggestions={AVOID_SUGGESTIONS}
              onAdd={v => setAvoidTerms(a => a.includes(v) ? a : [...a, v])}
              onRemove={v => setAvoidTerms(a => a.filter(x => x !== v))} />
            <div className="onboarding-field">
              <label>Score mínimo para aparecer no radar</label>
              <div className="onboarding-range">
                <input type="range" min={0} max={100} step={5} value={minScore} onChange={e => setMinScore(Number(e.target.value))} />
                <strong>{minScore}%</strong>
              </div>
              <p className="onboarding-sub" style={{ margin: "6px 0 0" }}>{scoreLabel}</p>
            </div>
            <div className="onboarding-nav">
              <button type="button" className="icon-btn" onClick={() => setStep(2)}>Voltar</button>
              <button type="button" className="primary" onClick={() => setStep(4)}>Calcular meu radar →</button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div>
            <h2>Seu radar está pronto</h2>
            <p className="onboarding-sub">Já calculamos a aderência das vagas ativas com o que você nos contou.</p>
            {message && <div className="notice">{message}</div>}
            {scored.length === 0 && <div className="notice">Nenhuma vaga ativa combina com esse filtro ainda.</div>}
            {scored.map(job => (
              <div className="onboarding-job" key={job.id}>
                <div className="onboarding-job-top">
                  <div>
                    <small>{job.company.toUpperCase()}</small>
                    <h3>{job.title}</h3>
                    <p>{job.location ?? "Local não informado"} · {job.workMode ?? "—"}</p>
                  </div>
                  <span className="onboarding-score">{job.score}%</span>
                </div>
                <div className="onboarding-reasons">{job.reasons.map(r => `✓ ${r}`).join("   ")}</div>
              </div>
            ))}
            <div className="onboarding-nav">
              <button type="button" className="icon-btn" onClick={() => setStep(3)}>Voltar</button>
              <button type="button" className="primary" disabled={saving} onClick={persist}>Entrar no Radar →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
