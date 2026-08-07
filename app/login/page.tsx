"use client";

import { FormEvent, useState } from "react";
import { useSearchParams } from "next/navigation";

function safeReturnTo(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export default function LoginPage() {
  const searchParams = useSearchParams();
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

  return <main className="login-page"><form className="login-card" onSubmit={submit}>
    <div className="login-brand"><span>R</span><strong>RADAR<br />CARREIRA</strong></div>
    <p className="eyebrow">ACESSO AO PORTAL</p>
    <h1>{creatingAccount ? "Criar sua conta" : "Entrar no Radar"}</h1>
    <p>{creatingAccount ? "Use seu e-mail e uma senha para começar a acompanhar vagas." : "Administradores entram apenas com a senha. Usuários entram com e-mail e senha."}</p>
    {creatingAccount && <label>Nome completo<input autoComplete="name" onChange={event => setName(event.target.value)} placeholder="Seu nome" required value={name} /></label>}
    <label>E-mail <small>{creatingAccount ? "usado para acessar sua conta" : "somente para usuários cadastrados"}</small><input autoComplete="username" onChange={event => setEmail(event.target.value)} placeholder="voce@exemplo.com" type="email" value={email} /></label>
    <label>Senha<input autoComplete="current-password" autoFocus onChange={event => setPassword(event.target.value)} required type="password" value={password} /></label>
    {creatingAccount && <label>Confirmar senha<input autoComplete="new-password" onChange={event => setPasswordConfirmation(event.target.value)} required type="password" value={passwordConfirmation} /></label>}
    {(error || searchParams.get("auth_error") === "chatgpt") && <p className="login-error" role="alert">{error || "O acesso com ChatGPT funciona ao abrir o Radar pela versão hospedada no ChatGPT."}</p>}
    <button className="primary" disabled={submitting} type="submit">{submitting ? (creatingAccount ? "Criando…" : "Entrando…") : (creatingAccount ? "Criar conta" : "Entrar")}</button>
    <button className="login-secondary" onClick={() => { setCreatingAccount(value => !value); setError(""); }} type="button">{creatingAccount ? "Já tenho uma conta" : "Criar minha conta"}</button>
    <div className="login-alternative"><span>ou</span></div>
    <a className="login-chatgpt" href="/api/auth/chatgpt?return_to=%2F">Continuar com ChatGPT</a>
    <small className="login-chatgpt-hint">Disponível ao abrir o Radar pela versão hospedada no ChatGPT.</small>
  </form></main>;
}
