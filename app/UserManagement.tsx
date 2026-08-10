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

type Permission = { id: string; module: string; description: string };

type Role = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: string;
  permissionIds: string[];
  userCount: number;
  groupCount: number;
};

const blankInvite = { name: "", email: "", password: "" };
const blankRole = { name: "", description: "", permissionIds: [] as string[] };
// Nunca oferecidas na UI de criação/edição de perfil — exclusivas da
// administração principal (bypass direto em can()), reforçado também no
// backend em app/api/admin/roles/*.
const OWNER_ONLY_PERMISSIONS = new Set(["roles.manage", "groups.manage"]);

export default function UserManagement({ close }: { close: () => void }) {
  const [tab, setTab] = useState<"usuarios" | "perfis">("usuarios");
  const [users, setUsers] = useState<User[]>([]);
  const [query, setQuery] = useState("");
  const [invite, setInvite] = useState(blankInvite);
  const [message, setMessage] = useState("Carregando usuários…");
  const [submitting, setSubmitting] = useState(false);
  const [changingRole, setChangingRole] = useState<string | null>(null);

  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [rolesLoaded, setRolesLoaded] = useState(false);
  const [rolesAllowed, setRolesAllowed] = useState(true);
  const [roleMessage, setRoleMessage] = useState("");
  const [roleForm, setRoleForm] = useState(blankRole);
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [savingRole, setSavingRole] = useState(false);

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

  async function loadRoles() {
    const [rolesResponse, permissionsResponse] = await Promise.all([
      fetch("/api/admin/roles"),
      fetch("/api/admin/permissions"),
    ]);
    if (rolesResponse.ok && permissionsResponse.ok) {
      const rolesData = await rolesResponse.json();
      const permissionsData = await permissionsResponse.json();
      setRoles(rolesData.roles);
      setPermissions(permissionsData.permissions);
      setRolesAllowed(true);
    } else {
      setRolesAllowed(false);
    }
    setRolesLoaded(true);
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

  function openTab(next: "usuarios" | "perfis") {
    setTab(next);
    if (next === "perfis" && !rolesLoaded) void loadRoles();
  }

  function startCreateRole() {
    setEditingRoleId("new");
    setRoleForm(blankRole);
    setRoleMessage("");
  }

  function startEditRole(role: Role) {
    setEditingRoleId(role.id);
    setRoleForm({ name: role.name, description: role.description ?? "", permissionIds: role.permissionIds });
    setRoleMessage("");
  }

  function cancelRoleEdit() {
    setEditingRoleId(null);
    setRoleForm(blankRole);
  }

  function togglePermission(id: string) {
    setRoleForm(current => ({
      ...current,
      permissionIds: current.permissionIds.includes(id)
        ? current.permissionIds.filter(item => item !== id)
        : [...current.permissionIds, id],
    }));
  }

  async function saveRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingRole(true);
    setRoleMessage("");
    const isNew = editingRoleId === "new";
    const url = isNew ? "/api/admin/roles" : `/api/admin/roles/${editingRoleId}`;
    const response = await fetch(url, {
      method: isNew ? "POST" : "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: roleForm.name, description: roleForm.description, permissionIds: roleForm.permissionIds }),
    });
    const data = await response.json();
    if (response.ok) {
      setEditingRoleId(null);
      setRoleForm(blankRole);
      setRolesLoaded(false);
      await loadRoles();
      setRoleMessage(isNew ? "Perfil criado." : "Perfil atualizado.");
    } else {
      setRoleMessage(data.error ?? "Não foi possível salvar o perfil.");
    }
    setSavingRole(false);
  }

  async function deleteRole(role: Role) {
    setRoleMessage("");
    const response = await fetch(`/api/admin/roles/${role.id}`, { method: "DELETE" });
    const data = await response.json();
    if (response.ok) {
      setRolesLoaded(false);
      await loadRoles();
      setRoleMessage("Perfil excluído.");
    } else {
      setRoleMessage(data.error ?? "Não foi possível excluir o perfil.");
    }
  }

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
  const permissionsByModule = permissions.reduce<Record<string, Permission[]>>((acc, permission) => {
    (acc[permission.module] ??= []).push(permission);
    return acc;
  }, {});

  return <div className="modal-backdrop" onClick={close}><section className="modal users-modal" onClick={event => event.stopPropagation()}>
    <button className="modal-close" onClick={close}>×</button>
    <p className="eyebrow">ADMINISTRAÇÃO DE ACESSO</p>
    <div className="users-tabs">
      <button className={tab === "usuarios" ? "active" : ""} onClick={() => openTab("usuarios")}>Usuários</button>
      <button className={tab === "perfis" ? "active" : ""} onClick={() => openTab("perfis")}>Perfis</button>
    </div>

    {tab === "usuarios" && <>
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
    </>}

    {tab === "perfis" && <>
      <div className="users-title"><div><h2>Perfis de acesso (RBAC)</h2><p>{roles.length} perfis cadastrados · permissões granulares além de admin/usuário comum</p></div></div>
      {!rolesLoaded && <div className="notice">Carregando perfis…</div>}
      {rolesLoaded && !rolesAllowed && <div className="notice">Acesso exclusivo à administração principal.</div>}
      {rolesLoaded && rolesAllowed && <>
        {roleMessage && <div className="notice">{roleMessage}</div>}
        {editingRoleId === null && <button className="primary" onClick={startCreateRole}>Criar novo perfil</button>}

        {editingRoleId !== null && <form className="invite-form" onSubmit={saveRole}>
          <div><strong>{editingRoleId === "new" ? "Novo perfil" : "Editar perfil"}</strong><small>Marque as permissões que este perfil concede. roles.manage e groups.manage são exclusivas da administração principal.</small></div>
          <label>Nome<input required maxLength={80} value={roleForm.name} onChange={event => setRoleForm({ ...roleForm, name: event.target.value })} placeholder="Ex.: Curador de fontes" /></label>
          <label>Descrição<input value={roleForm.description} onChange={event => setRoleForm({ ...roleForm, description: event.target.value })} placeholder="Para que serve este perfil" /></label>
          <div className="role-permissions">
            {Object.entries(permissionsByModule).map(([module, items]) => <div key={module} className="role-permissions-module">
              <strong>{module}</strong>
              {items.map(permission => {
                const ownerOnly = OWNER_ONLY_PERMISSIONS.has(permission.id);
                return <label key={permission.id} className={ownerOnly ? "role-permission-disabled" : ""}>
                  <input
                    type="checkbox"
                    disabled={ownerOnly}
                    checked={!ownerOnly && roleForm.permissionIds.includes(permission.id)}
                    onChange={() => togglePermission(permission.id)}
                  />
                  {permission.description} <small>({permission.id})</small>
                </label>;
              })}
            </div>)}
          </div>
          <button className="primary" disabled={savingRole} type="submit">{savingRole ? "Salvando…" : "Salvar perfil"}</button>
          <button type="button" onClick={cancelRoleEdit}>Cancelar</button>
        </form>}

        <div className="users-list">{roles.map(role => <article key={role.id}>
          <div className="user-initial">{role.name.slice(0, 2).toUpperCase()}</div>
          <div>
            <small>{role.permissionIds.length} permissões · {role.userCount} usuário(s) · {role.groupCount} grupo(s){role.isSystem ? " · perfil do sistema" : ""}</small>
            <h3>{role.name}</h3>
            <p>{role.description ?? "Sem descrição"}</p>
          </div>
          <span className={role.isSystem ? "complete" : "pending"}>{role.isSystem ? "Sistema" : "Personalizado"}</span>
          {!role.isSystem && <>
            <button className="role-toggle" onClick={() => startEditRole(role)}>Editar</button>
            <button className="role-toggle" disabled={role.userCount > 0 || role.groupCount > 0} onClick={() => void deleteRole(role)}>Excluir</button>
          </>}
        </article>)}</div>
      </>}
    </>}
  </section></div>;
}
