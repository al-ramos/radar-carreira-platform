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
      <div className="login-brand"><span>R</span><strong>RADAR<br />CARREIRA</strong></div>
      <h1>Todas as suas vagas, num só lugar</h1>
      <p>O radar cruza LinkedIn e outras fontes automaticamente, calcula sua aderência a cada vaga e organiza tudo num pipeline — sem você abrir dez abas por dia.</p>
      <ul className="login-pitch-list">
        <li><span className="login-pitch-icon">📡</span><div><strong>Vagas de várias fontes</strong><small>LinkedIn e outros sites reunidos automaticamente todo dia.</small></div></li>
        <li><span className="login-pitch-icon">🎯</span><div><strong>Score de aderência</strong><small>Cada vaga ganha uma nota de match com seu perfil.</small></div></li>
        <li><span className="login-pitch-icon">🗂️</span><div><strong>Pipeline de candidaturas</strong><small>Acompanhe salvas, candidaturas, entrevistas e encerradas.</small></div></li>
        <li><span className="login-pitch-icon">🔔</span><div><strong>Alertas e métricas</strong><small>Avisos de novas vagas e visão geral da sua busca.</small></div></li>
      </ul>
    </section>
    <form className="login-card" onSubmit={submit}>
    <p className="eyebrow">ACESSO AO PORTAL</p>
    <h1>{creatingAccount ? "Criar sua conta" : "Entrar no Radar"}</h1>
    <p>{creatingAccount ? "Use seu e-mail e uma senha para começar a acompanhar vagas." : "Administradores entram apenas com a senha. Usuários entram com e-mail e senha."}</p>
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
