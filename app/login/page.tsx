"use client";

import { FormEvent, useState } from "react";

function safeReturnTo(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export default function LoginPage() {
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    if (creatingAccount && password !== passwordConfirmation) {
      setError("As senhas não coincidem.");
      setSubmitting(false);
      return;
    }
    try {
      const response = await fetch(creatingAccount ? "/api/auth/register" : "/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(creatingAccount ? { name, email, password } : { email, password }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Não foi possível entrar.");
      window.location.assign(safeReturnTo(new URLSearchParams(window.location.search).get("return_to")));
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Não foi possível entrar.");
      setSubmitting(false);
    }
  }

  return <main className="login-page">
    <section className="login-pitch">
      <div className="login-brand"><span aria-hidden="true" /><strong>RADAR<br />CARREIRA</strong></div>
      <h1>Pare de abrir dez abas por dia</h1>
      <p>O radar junta LinkedIn e outras fontes num só lugar, calcula sua aderência a cada vaga e organiza tudo num pipeline — da triagem à entrevista.</p>
      <ul className="login-pitch-list">
        <li><span className="login-pitch-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a10 10 0 1 0 10 10" /><path d="M12 2v10l7-7" /><circle cx="12" cy="12" r="1" /></svg></span><div><strong>Todas as fontes, um radar</strong><small>LinkedIn e outros sites reunidos automaticamente todo dia.</small></div></li>
        <li><span className="login-pitch-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></svg></span><div><strong>Sabe onde focar</strong><small>Cada vaga ganha uma nota de match com seu perfil.</small></div></li>
        <li><span className="login-pitch-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg></span><div><strong>Candidaturas sob controle</strong><small>Acompanhe salvas, entrevistas e encerradas num pipeline só.</small></div></li>
        <li><span className="login-pitch-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6Z" /><path d="M10 20a2 2 0 0 0 4 0" /></svg></span><div><strong>Nada passa despercebido</strong><small>Alertas de vagas novas e visão geral da sua busca.</small></div></li>
      </ul>
    </section>
    <form className="login-card" onSubmit={submit}>
    <p className="eyebrow">ACESSO AO PORTAL</p>
    <h1>{creatingAccount ? "Criar sua conta" : "Entrar no Radar"}</h1>
    <p>{creatingAccount ? "Use seu e-mail e uma senha para começar a acompanhar vagas." : "Entre com e-mail e senha para acessar suas vagas."}</p>
    {creatingAccount && <label>Nome completo<input autoComplete="name" onChange={event => setName(event.target.value)} placeholder="Seu nome" required value={name} /></label>}
    <label>E-mail <small>{creatingAccount ? "usado para acessar sua conta" : "somente para usuários cadastrados"}</small><input autoComplete="username" onChange={event => setEmail(event.target.value)} placeholder="voce@exemplo.com" type="email" value={email} /></label>
    <label>Senha<input autoComplete="current-password" autoFocus onChange={event => setPassword(event.target.value)} required type="password" value={password} /></label>
    {creatingAccount && <label>Confirmar senha<input autoComplete="new-password" onChange={event => setPasswordConfirmation(event.target.value)} required type="password" value={passwordConfirmation} /></label>}
    {error && <p className="login-error" role="alert">{error}</p>}
    <button className="primary" disabled={submitting} type="submit">{submitting ? (creatingAccount ? "Criando…" : "Entrando…") : (creatingAccount ? "Criar conta" : "Entrar")}</button>
    <button className="login-secondary" onClick={() => { setCreatingAccount(value => !value); setError(""); }} type="button">{creatingAccount ? "Já tenho uma conta" : "Criar minha conta"}</button>
  </form>
  </main>;
}
