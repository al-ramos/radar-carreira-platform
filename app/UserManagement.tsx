"use client";

import { FormEvent, useEffect, useState } from "react";

type User = {
  userId: string;
  email: string;
  name: string | null;
  role: "admin" | "user";
  seniority: string | null;
  preferredMode: string | null;
  skills: number;
  areas: number;
  pipeline: number;
  profileComplete: boolean;
  protected: boolean;
  access: "convite" | "chatgpt" | "administrador";
  updatedAt: string;
};

const blankInvite = { name: "", email: "", password: "" };

export default function UserManagement({ close }: { close: () => void }) {
  const [users, setUsers] = useState<User[]>([]);
  const [query, setQuery] = useState("");
  const [invite, setInvite] = useState(blankInvite);
  const [message, setMessage] = useState("Carregando usuários…");
  const [submitting, setSubmitting] = useState(false);
  const [changingRole, setChangingRole] = useState<string | null>(null);

  async function load() {
    const response = await fetch("/api/admin/users");
    const data = await response.json();
    if (response.ok) {
      setUsers(data.users);
      setMessage("");
    } else {
      setMessage("Acesso exclusivo para administradores.");
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/users")
      .then(async response => ({ ok: response.ok, data: await response.json() }))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (ok) {
          setUsers(data.users);
          setMessage("");
        } else {
          setMessage("Acesso exclusivo para administradores.");
        }
      })
      .catch(() => { if (!cancelled) setMessage("Não foi possível carregar os usuários."); });
    return () => { cancelled = true; };
  }, []);

  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(invite),
    });
    const data = await response.json();
    if (response.ok) {
      setInvite(blankInvite);
      await load();
      setMessage("Conta criada como administradora. Envie a senha inicial à pessoa por um canal seguro.");
    } else {
      setMessage(data.error ?? "Não foi possível criar a conta.");
    }
    setSubmitting(false);
  }

  async function changeRole(user: User) {
    const nextRole = user.role === "admin" ? "user" : "admin";
    setChangingRole(user.userId);
    setMessage("");
    const response = await fetch(`/api/admin/users/${user.userId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: nextRole }),
    });
    const data = await response.json();
    if (response.ok) {
      await load();
      setMessage(nextRole === "admin" ? "Usuário promovido a administrador." : "Usuário rebaixado para acesso comum.");
    } else {
      setMessage(data.error ?? "Não foi possível alterar o papel do usuário.");
    }
    setChangingRole(null);
  }

  const filtered = users.filter(user => `${user.name} ${user.email}`.toLowerCase().includes(query.toLowerCase()));

  return <div className="modal-backdrop" onClick={close}><section className="modal users-modal" onClick={event => event.stopPropagation()}>
    <button className="modal-close" onClick={close}>×</button>
    <p className="eyebrow">ADMINISTRAÇÃO DE ACESSO</p>
    <div className="users-title"><div><h2>Usuários do portal</h2><p>{users.length} contas cadastradas · todas possuem acesso administrativo</p></div><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar nome ou e-mail" /></div>
    <form className="invite-form" onSubmit={createInvite}>
      <div><strong>Convidar usuário</strong><small>Crie o acesso e compartilhe a senha inicial diretamente com a pessoa.</small></div>
      <label>Nome<input required value={invite.name} onChange={event => setInvite({ ...invite, name: event.target.value })} placeholder="Nome completo" /></label>
      <label>E-mail<input required type="email" value={invite.email} onChange={event => setInvite({ ...invite, email: event.target.value })} placeholder="pessoa@exemplo.com" /></label>
      <label>Senha inicial<input required minLength={4} type="password" value={invite.password} onChange={event => setInvite({ ...invite, password: event.target.value })} placeholder="mínimo de 4 caracteres" /></label>
      <button className="primary" disabled={submitting} type="submit">{submitting ? "Criando…" : "Criar convite"}</button>
    </form>
    {message && <div className="notice">{message}</div>}
    <div className="users-list">{filtered.map(user => <article key={user.userId}><div className="user-initial">{(user.name ?? user.email).slice(0, 2).toUpperCase()}</div><div><small>{user.email} · {user.access === "convite" ? "convite" : user.access === "chatgpt" ? "ChatGPT" : "administrador principal"}</small><h3>{user.name ?? "Nome não informado"}</h3><p>{user.seniority ?? "Senioridade pendente"} · {user.preferredMode ?? "Modalidade pendente"} · {user.skills} competências · {user.pipeline} no pipeline</p></div><span className={user.profileComplete ? "complete" : "pending"}>{user.profileComplete ? "Perfil completo" : "Perfil pendente"}</span>{user.protected ? <span className="complete">Administrador</span> : <button className="role-toggle" disabled={changingRole === user.userId} onClick={() => void changeRole(user)}>{changingRole === user.userId ? "Alterando…" : user.role === "admin" ? "Rebaixar para usuário" : "Promover a admin"}</button>}</article>)}</div>
  </section></div>;
}
