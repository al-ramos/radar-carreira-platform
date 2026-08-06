"use client";

import { FormEvent, useState } from "react";
import { useSearchParams } from "next/navigation";

function safeReturnTo(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export default function LoginPage() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Não foi possível entrar.");
      window.location.assign(safeReturnTo(new URLSearchParams(window.location.search).get("return_to")));
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Não foi possível entrar.");
      setSubmitting(false);
    }
  }

  return <main className="login-page"><form className="login-card" onSubmit={submit}>
    <div className="login-brand"><span>R</span><strong>RADAR<br />CARREIRA</strong></div>
    <p className="eyebrow">ACESSO AO PORTAL</p>
    <h1>Entrar no Radar</h1>
    <p>Administradores entram apenas com a senha. Usuários convidados informam seu e-mail e senha individual.</p>
    <label>E-mail <small>somente para usuários convidados</small><input autoComplete="username" onChange={event => setEmail(event.target.value)} placeholder="voce@exemplo.com" type="email" value={email} /></label>
    <label>Senha<input autoComplete="current-password" autoFocus onChange={event => setPassword(event.target.value)} required type="password" value={password} /></label>
    {(error || searchParams.get("auth_error") === "chatgpt") && <p className="login-error" role="alert">{error || "O acesso com ChatGPT funciona ao abrir o Radar pela versão hospedada no ChatGPT."}</p>}
    <button className="primary" disabled={submitting} type="submit">{submitting ? "Entrando…" : "Entrar"}</button>
    <div className="login-alternative"><span>ou</span></div>
    <a className="login-chatgpt" href="/api/auth/chatgpt?return_to=%2F">Continuar com ChatGPT</a>
    <small className="login-chatgpt-hint">Disponível ao abrir o Radar pela versão hospedada no ChatGPT.</small>
  </form></main>;
}
