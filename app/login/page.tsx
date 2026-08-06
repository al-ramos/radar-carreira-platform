"use client";

import { FormEvent, useState } from "react";

function safeReturnTo(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export default function LoginPage() {
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
        body: JSON.stringify({ password }),
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
    <p className="eyebrow">ACESSO ADMINISTRATIVO</p>
    <h1>Entrar no Radar</h1>
    <p>Use sua senha de administrador para acessar os recursos da plataforma.</p>
    <label>Senha de administrador<input autoComplete="current-password" autoFocus onChange={event => setPassword(event.target.value)} required type="password" value={password} /></label>
    {error && <p className="login-error" role="alert">{error}</p>}
    <button className="primary" disabled={submitting} type="submit">{submitting ? "Entrando…" : "Entrar"}</button>
  </form></main>;
}
