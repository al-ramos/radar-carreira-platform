<#
  Aplica o onboarding (item 20) no repositorio radar-carreira-platform.
  Uso:
    cd "C:\Users\al-ra\Documents\Codex\github\radar-carreira-platform"
    powershell -ExecutionPolicy Bypass -File apply_onboarding.ps1
  Parametros opcionais:
    -RepoPath "C:\outro\caminho"   caminho do repo, se nao estiver no diretorio atual
    -Branch "outro-nome"             nome da branch criada (padrao: feature/onboarding-flow)
    -Commit                          faz commit automatico das mudancas
    -Push                            alem de commitar, faz push da branch (implica -Commit)
#>
param(
  [string]$RepoPath = (Get-Location).Path,
  [string]$Branch = "feature/onboarding-flow",
  [switch]$Commit,
  [switch]$Push
)

$ErrorActionPreference = "Continue"

function Write-Utf8NoBom($Path, $Content) {
  $dir = Split-Path -Parent $Path
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $enc)
  Write-Host "  escrito: $Path"
}

if (-not (Test-Path (Join-Path $RepoPath "package.json"))) {
  throw "package.json nao encontrado em '$RepoPath'. Rode este script dentro do repo ou passe -RepoPath."
}

Push-Location $RepoPath
try {
  $isGitRepo = Test-Path ".git"
  if ($isGitRepo) {
    $currentBranch = git rev-parse --abbrev-ref HEAD
    Write-Host "Repo git detectado (branch atual: $currentBranch)."
    $existingBranch = git branch --list $Branch
    if ($existingBranch) {
      Write-Host "Branch '$Branch' ja existe - mudando para ela."
      git checkout $Branch
    } else {
      Write-Host "Criando branch '$Branch'."
      git checkout -b $Branch
    }
  } else {
    Write-Host "Aviso: '$RepoPath' nao parece um repo git (.git nao encontrado). Copiando os arquivos mesmo assim."
  }

  Write-Host ""
  Write-Host "Escrevendo arquivos novos..."
  Write-Utf8NoBom (Join-Path $RepoPath "app\onboarding\page.tsx") @'
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

'@

  Write-Utf8NoBom (Join-Path $RepoPath "app\OnboardingFlow.tsx") @'
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

'@

  Write-Host ""
  Write-Host "Substituindo arquivos existentes..."
  Write-Utf8NoBom (Join-Path $RepoPath "app\page.tsx") @'
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import Dashboard from "./Dashboard";
import { getChatGPTUser } from "./chatgpt-auth";
import { getDb } from "../db/index";
import { profiles } from "../db/schema";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Radar Carreira Platform",
  description: "Vagas certas. Decisões melhores.",
};

export default async function Home() {
  const user = await getChatGPTUser();
  if (user) {
    let needsOnboarding = false;
    try {
      const profile = (await getDb().select().from(profiles).where(eq(profiles.userId, user.userId)).limit(1))[0];
      needsOnboarding = !profile?.seniority;
    } catch {
      // banco indisponível — segue para o dashboard em vez de travar a home
    }
    if (needsOnboarding) redirect("/onboarding");
  }
  return <Dashboard />;
}

'@

  Write-Utf8NoBom (Join-Path $RepoPath "app\platform.css") @'
.notice{background:#eef6df;border:1px solid #d2e4ad;color:#37502c;padding:10px 14px;border-radius:8px;margin:12px 0;font-size:12px}.header-actions a{text-decoration:none;display:inline-flex;align-items:center;color:#173f32}.modal-backdrop{position:fixed;inset:0;background:#07140ed9;z-index:50;display:grid;place-items:center;padding:20px}.modal{width:min(680px,100%);background:#f8f9f4;border-radius:14px;padding:28px;box-shadow:0 30px 90px #0008;position:relative}.modal h2{font-size:30px;font-weight:650;margin:5px 0}.modal>p{color:#68746c;font-size:13px}.modal textarea{width:100%;height:270px;border:1px solid #ced5ca;border-radius:8px;background:white;padding:14px;font:12px Consolas,monospace;margin:14px 0;resize:vertical}.modal-close{position:absolute;right:17px;top:14px;border:0;background:transparent;font-size:26px}.modal .primary{float:right}@media(max-width:650px){.header-actions a{display:none}.modal{padding:20px}.modal textarea{height:230px}}
.source-modal{width:min(520px,100%)}.source-modal label{display:grid;gap:6px;margin:14px 0;color:#526159;font-size:11px;font-weight:bold;letter-spacing:.4px}.source-modal input,.source-modal select{width:100%;border:1px solid #ced5ca;background:#fff;border-radius:8px;padding:11px;color:#17231d}.source-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:20px}.source-actions button{border:1px solid #ced5ca;background:#fff;border-radius:8px;padding:11px 15px}.source-actions .primary{background:#173f32;color:#fff}
.profile-modal{width:min(720px,100%)}.profile-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.profile-grid label{display:grid;gap:6px;color:#526159;font-size:11px;font-weight:bold}.profile-grid .wide{grid-column:1/-1}.profile-grid input,.profile-grid select{width:100%;border:1px solid #ced5ca;background:#fff;border-radius:8px;padding:11px;color:#17231d}@media(max-width:650px){.profile-grid{grid-template-columns:1fr}.profile-grid .wide{grid-column:auto}}
.pipeline-modal{width:min(1240px,96vw);max-height:92vh;overflow:auto}.kanban{display:grid;grid-template-columns:repeat(5,minmax(210px,1fr));gap:12px;margin-top:20px;overflow-x:auto;padding-bottom:8px}.kanban-column{background:#edf0e9;border:1px solid #d7ddd2;border-radius:11px;padding:10px;min-height:310px}.kanban-column>header{display:flex;align-items:center;justify-content:space-between;padding:4px 3px 10px;font-size:12px;text-transform:uppercase;letter-spacing:.5px}.kanban-column>header span{display:grid;place-items:center;width:23px;height:23px;border-radius:50%;background:#173f32;color:#fff}.pipeline-card{background:#fff;border:1px solid #d9dfd5;border-radius:9px;padding:13px;margin-bottom:10px;box-shadow:0 3px 12px #18392c0a}.pipeline-card small{color:#708078;text-transform:uppercase;font-weight:700}.pipeline-card h3{font-size:14px;margin:5px 0;line-height:1.25}.pipeline-card p{font-size:11px;color:#68746c;line-height:1.4}.pipeline-card select{width:100%;border:1px solid #ced5ca;border-radius:7px;background:#f8f9f4;padding:8px;margin-top:8px}.pipeline-card textarea{height:76px;margin:8px 0;font-family:var(--font-geist),sans-serif;resize:vertical}.pipeline-actions{display:flex;gap:6px}.pipeline-actions button{flex:1;border:1px solid #ced5ca;background:#fff;border-radius:7px;padding:7px;font-size:10px;color:#173f32}.pipeline-empty{padding:35px;text-align:center;color:#68746c;background:#f0f2ed;border-radius:10px;margin-top:18px}@media(max-width:850px){.pipeline-modal{padding:20px}.kanban{grid-template-columns:repeat(5,230px)}}

/* — onboarding (item 20) — */
.onboarding{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:40px 20px;background:var(--paper)}
.onboarding-card{width:min(720px,100%);background:#fff;border:1px solid var(--line);border-radius:14px;padding:36px;box-shadow:0 30px 90px #0001}
.onboarding-progress{display:flex;align-items:center;gap:14px;margin-bottom:26px}
.onboarding-progress .track{flex:1;height:6px;border-radius:99px;background:#e7ebe1;overflow:hidden}
.onboarding-progress .track i{display:block;height:100%;background:var(--green)}
.onboarding-progress span{font-size:10px;letter-spacing:1.5px;color:#7b857e;font-weight:bold;white-space:nowrap}
.onboarding h1{font:32px var(--font-geist),Geist,sans-serif;margin:8px 0 10px}
.onboarding h2{font:26px var(--font-geist),Geist,sans-serif;margin:0 0 8px}
.onboarding-sub{color:#68746c;font-size:14px;margin:0 0 26px}
.onboarding-features{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:30px}
.onboarding-features div{display:flex;flex-direction:column;gap:6px}
.onboarding-features .ico{width:38px;height:38px;border-radius:50%;background:#eef6df;display:grid;place-items:center;color:#365c31;font-size:16px}
.onboarding-features strong{font-size:13px}
.onboarding-features small{font-size:11px;color:#7b857e}
.onboarding-field{margin-bottom:26px}
.onboarding-field>label{display:block;font-size:11px;font-weight:bold;letter-spacing:.4px;color:#526159;margin-bottom:8px}
.onboarding-chip-row{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px}
.chip{display:inline-flex;align-items:center;gap:6px;border-radius:99px;padding:6px 12px;font-size:11px;border:0;cursor:pointer;font:inherit}
.chip-on{background:var(--green);color:#fff}
.chip-off{background:#fff;border:1px solid var(--line);color:var(--ink)}
.onboarding-add{display:flex;gap:8px;max-width:360px}
.onboarding-add input{flex:1;border:1px solid var(--line);border-radius:8px;padding:9px 12px;font:inherit}
.onboarding-add button{border:1px solid var(--line);background:#fff;border-radius:8px;width:38px;font-size:16px;cursor:pointer}
.onboarding-seg{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden}
.onboarding-seg button{border:0;background:#fff;padding:9px 16px;font-size:13px;cursor:pointer}
.onboarding-seg button+button{border-left:1px solid var(--line)}
.onboarding-seg button.on{background:var(--green);color:#fff}
.onboarding-range{display:flex;align-items:center;gap:16px}
.onboarding-range input{flex:1;accent-color:var(--green)}
.onboarding-range strong{font:20px var(--font-geist),Geist,sans-serif;min-width:50px;text-align:right}
.onboarding-nav{display:flex;justify-content:space-between;margin-top:30px}
.onboarding-job{border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin-bottom:10px}
.onboarding-job-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
.onboarding-job small{font-size:9px;letter-spacing:1px;color:#7b857e}
.onboarding-job h3{margin:4px 0 6px;font:15px var(--font-geist),Geist,sans-serif}
.onboarding-job p{margin:0;font-size:10px;color:#717b75}
.onboarding-score{flex:none;background:#eef6df;color:#365c31;border-radius:99px;padding:4px 12px;font:14px var(--font-geist),Geist,sans-serif}
.onboarding-reasons{font-size:11px;color:#526159;margin-top:8px}
.onboarding-skip{background:none;border:0;color:#68746c;font-size:12px;cursor:pointer;text-decoration:underline;padding:0}

'@

  Write-Utf8NoBom (Join-Path $RepoPath "app\api\jobs\route.ts") @'
import { and, desc, eq, gte } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db/index";
import { jobs, profiles } from "../../../db/schema";
import { scoreJob } from "../../../lib/scoring";

export const dynamic = "force-dynamic";
const parse = (value: string) => { try { return JSON.parse(value) as string[]; } catch { return []; } };

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 250);
    const period = url.searchParams.get("period") ?? "24";
    const hours = period === "all" ? null : Math.max(1, Math.min(Number(period) || 24, 24 * 30));
    // usado só pela prévia do onboarding: pontua o perfil em construção contra TODAS as vagas ativas,
    // sem descartar as que ficam abaixo do minScore ainda salvo no perfil do usuário.
    const bypassScoreFilter = url.searchParams.get("all") === "1";
    const user = await getChatGPTUser();
    let profile: null | typeof profiles.$inferSelect = null;
    if (user) profile = (await getDb().select().from(profiles).where(eq(profiles.userId, user.userId)).limit(1))[0] ?? null;

    const cutoff = hours ? new Date(Date.now() - hours * 36e5) : null;
    const condition = cutoff ? and(eq(jobs.status, "active"), gte(jobs.publishedAt, cutoff)) : eq(jobs.status, "active");
    const rows = await getDb().select().from(jobs).where(condition).orderBy(desc(jobs.publishedAt)).limit(limit);
    const result = rows.map(job => {
      const stack = parse(job.stack);
      const match = profile ? scoreJob({title:job.title,description:job.description,stack,seniority:job.seniority,workMode:job.workMode,location:job.location,publishedAt:job.publishedAt},{masteredSkills:parse(profile.masteredSkills),desiredAreas:parse(profile.desiredAreas),avoidTerms:parse(profile.avoidTerms),seniority:profile.seniority,preferredMode:profile.preferredMode,cities:parse(profile.cities)}) : {score:70,reasons:["Complete seu perfil para personalizar"]};
      return {...job,stack,score:match.score,reasons:match.reasons};
    }).filter(job => bypassScoreFilter || !profile || job.score >= profile.minScore);
    return NextResponse.json({jobs:result,mode:"database",personalized:Boolean(profile),period:period === "all" ? "all" : hours});
  } catch (error) {
    return NextResponse.json({jobs:[],mode:"unavailable",error:error instanceof Error?error.message:"Banco indisponível"},{status:503});
  }
}

'@

  Write-Host ""
  Write-Host "Arquivos aplicados."

  if ($isGitRepo -and ($Commit -or $Push)) {
    git add app/onboarding/page.tsx app/OnboardingFlow.tsx app/page.tsx app/platform.css app/api/jobs/route.ts
    git commit -m "feat: onboarding flow para novos usuarios (item 20)"
    if ($LASTEXITCODE -ne 0) {
      Write-Host "Nada novo para commitar (arquivos ja estavam iguais)."
    } else {
      Write-Host "Commit criado na branch '$Branch'."
    }
    if ($Push) {
      git push -u origin $Branch
      Write-Host "Branch enviada para origin/$Branch."
    }
  } elseif ($isGitRepo) {
    Write-Host ""
    Write-Host "Mudancas nao commitadas (rode com -Commit para commitar, ou revise com 'git diff' / 'git status')."
  }

  Write-Host ""
  Write-Host "Proximo passo: 'npm run build' para validar antes de abrir o PR."
} finally {
  Pop-Location
}
