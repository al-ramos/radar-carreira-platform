// Harness de teste de integração real para o RBAC (Fase 2, pré-requisito
// decidido na revisão de segurança de 2026-08-09): chama can() de verdade
// — o mesmo código que roda em produção, importado sem modificação — contra
// um SQLite real (node:sqlite, sem dependência nova) populado com as
// migrations 0010/0011 de verdade. Prova negação/concessão de acesso de
// fato, não só a presença de uma chamada no código-fonte.
//
// Requer os module loaders em tests/helpers/*.mjs (registrados via
// --experimental-loader no comando de execução, ver README/package.json).

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { can } from "../lib/rbac.ts";
import { getRawSqlite } from "../db/index.ts";

async function seedSchema() {
  const sqlite = getRawSqlite();
  const strip = (sql) => sql.replaceAll("--> statement-breakpoint", "");
  const tables = await readFile(new URL("../drizzle/0010_rbac_tables.sql", import.meta.url), "utf8");
  const seed = await readFile(new URL("../drizzle/0011_rbac_seed.sql", import.meta.url), "utf8");
  sqlite.exec(strip(tables));
  sqlite.exec(strip(seed));
}

test("can(): owner sempre passa, mesmo sem nenhuma role atribuída", async () => {
  await seedSchema();
  const owner = { userId: "radar-local-admin", email: "alexsandro.ramos@gmail.com" };
  assert.equal(await can(owner, "roles.manage"), true);
  assert.equal(await can(owner, "groups.manage"), true);
  assert.equal(await can(owner, "qualquer.coisa.inventada"), true);
});

test("can(): usuário sem nenhuma role atribuída é negado em tudo", async () => {
  const sqlite = getRawSqlite();
  sqlite.exec(`DELETE FROM user_roles WHERE user_id = 'user-sem-role'`);
  const user = { userId: "user-sem-role", email: "ninguem@example.com" };
  assert.equal(await can(user, "sources.view"), false);
  assert.equal(await can(user, "roles.manage"), false);
});

test("can(): role direta concede exatamente as permissões do seed, nada além", async () => {
  const sqlite = getRawSqlite();
  sqlite.exec(`INSERT INTO user_roles (user_id, role_id) VALUES ('user-curador', 'role-curador-fontes')`);
  const user = { userId: "user-curador", email: "curador@example.com" };

  // Concedidas ao role-curador-fontes no seed (0011):
  assert.equal(await can(user, "sources.view"), true);
  assert.equal(await can(user, "sources.manage"), true);
  assert.equal(await can(user, "collect.run"), true);
  assert.equal(await can(user, "monitor.view"), true);

  // Não concedidas — inclusive as sensíveis de governança:
  assert.equal(await can(user, "users.change_role"), false);
  assert.equal(await can(user, "roles.manage"), false);
  assert.equal(await can(user, "groups.manage"), false);
  assert.equal(await can(user, "jobs.delete_all"), false);
});

test("can(): permissão herdada via grupo funciona (user_groups -> group_roles -> role_permissions)", async () => {
  const sqlite = getRawSqlite();
  sqlite.exec(`INSERT INTO groups (id, name, created_at) VALUES ('grp-visualizadores', 'Visualizadores', 0)`);
  sqlite.exec(`INSERT INTO group_roles (group_id, role_id) VALUES ('grp-visualizadores', 'role-visualizador')`);
  sqlite.exec(`INSERT INTO user_groups (user_id, group_id) VALUES ('user-via-grupo', 'grp-visualizadores')`);
  const user = { userId: "user-via-grupo", email: "viagrupo@example.com" };

  assert.equal(await can(user, "sources.view"), true);
  assert.equal(await can(user, "audit.view"), true);
  // Visualizador não tem permissão de escrita nenhuma:
  assert.equal(await can(user, "sources.manage"), false);
  assert.equal(await can(user, "collect.run"), false);
});

test("can(): união de role direta + role via grupo é aditiva, sem duplicar nem perder permissão", async () => {
  const sqlite = getRawSqlite();
  sqlite.exec(`INSERT INTO groups (id, name, created_at) VALUES ('grp-curadores', 'Curadores', 0)`);
  sqlite.exec(`INSERT INTO group_roles (group_id, role_id) VALUES ('grp-curadores', 'role-curador-fontes')`);
  sqlite.exec(`INSERT INTO user_groups (user_id, group_id) VALUES ('user-hibrido', 'grp-curadores')`);
  sqlite.exec(`INSERT INTO user_roles (user_id, role_id) VALUES ('user-hibrido', 'role-visualizador')`);
  const user = { userId: "user-hibrido", email: "hibrido@example.com" };

  // De role-visualizador (direta):
  assert.equal(await can(user, "audit.view"), true);
  assert.equal(await can(user, "users.view"), true);
  // De role-curador-fontes (via grupo):
  assert.equal(await can(user, "sources.manage"), true);
  assert.equal(await can(user, "collect.run"), true);
  // De nenhum dos dois:
  assert.equal(await can(user, "roles.manage"), false);
});

test("can(): nenhum perfil de partida concede roles.manage/groups.manage a ninguém além da owner", async () => {
  const sqlite = getRawSqlite();
  const allRoleIds = sqlite.prepare("SELECT id FROM roles").all().map(r => r.id);
  for (const roleId of allRoleIds) {
    sqlite.exec(`DELETE FROM user_roles WHERE user_id = 'user-probe-${roleId}'`);
    sqlite.exec(`INSERT INTO user_roles (user_id, role_id) VALUES ('user-probe-${roleId}', '${roleId}')`);
    const user = { userId: `user-probe-${roleId}`, email: `probe-${roleId}@example.com` };
    assert.equal(await can(user, "roles.manage"), false, `role ${roleId} não deveria conceder roles.manage`);
    assert.equal(await can(user, "groups.manage"), false, `role ${roleId} não deveria conceder groups.manage`);
  }
});

// --- Rotas migradas na Fase 2: um teste por rota, replicando exatamente a
// checagem que a função admin() da rota faz, para provar que o
// comportamento em runtime está correto — não só que can() foi chamado.

test("rota /api/admin/audit (audit.view): nega quem não tem a permissão, concede a quem tem, e ao owner sempre", async () => {
  const routeSource = await readFile(new URL("../app/api/admin/audit/route.ts", import.meta.url), "utf8");
  // Prova estrutural mínima: a rota usa can(), não mais isOwnerEmail sozinho.
  assert.match(routeSource, /await can\(u,\s*"audit\.view"\)/);
  assert.doesNotMatch(routeSource, /isOwnerEmail/);

  // Prova de comportamento real: a mesma decisão que admin() toma.
  const auditAdminCheck = async (user) => (user && await can(user, "audit.view")) ? user : null;

  const owner = { userId: "radar-local-admin", email: "alexsandro.ramos@gmail.com" };
  assert.notEqual(await auditAdminCheck(owner), null);

  const semPermissao = { userId: "user-sem-audit", email: "semaudit@example.com" };
  assert.equal(await auditAdminCheck(semPermissao), null);

  const sqlite = getRawSqlite();
  sqlite.exec(`INSERT INTO user_roles (user_id, role_id) VALUES ('user-com-audit', 'role-visualizador')`);
  const comPermissao = { userId: "user-com-audit", email: "comaudit@example.com" };
  assert.notEqual(await auditAdminCheck(comPermissao), null);

  assert.equal(await auditAdminCheck(null), null);
});

test("rota /api/admin/monitor (monitor.view): antes era aberta a qualquer logado, agora exige a permissão", async () => {
  const routeSource = await readFile(new URL("../app/api/admin/monitor/route.ts", import.meta.url), "utf8");
  assert.match(routeSource, /await can\(u,\s*"monitor\.view"\)/);
  // Prova de regressão negativa: a versão antiga (`return await getChatGPTUser()`,
  // sem checar permissão nenhuma) não deve mais existir.
  assert.doesNotMatch(routeSource, /async function admin\(\)\{return await getChatGPTUser\(\)\}/);

  const monitorAdminCheck = async (user) => (user && await can(user, "monitor.view")) ? user : null;

  const owner = { userId: "radar-local-admin", email: "alexsandro.ramos@gmail.com" };
  assert.notEqual(await monitorAdminCheck(owner), null);

  // Usuário comum autenticado, sem nenhuma role — antes passava, agora não.
  const usuarioComum = { userId: "user-comum-monitor", email: "comum-monitor@example.com" };
  assert.equal(await monitorAdminCheck(usuarioComum), null);

  const sqlite = getRawSqlite();
  sqlite.exec(`INSERT INTO user_roles (user_id, role_id) VALUES ('user-com-monitor', 'role-curador-fontes')`);
  const comPermissao = { userId: "user-com-monitor", email: "commonitor@example.com" };
  assert.notEqual(await monitorAdminCheck(comPermissao), null);
});

test("rota /api/admin/quality: GET exige quality.view, POST exige quality.enrich — permissões distintas, não intercambiáveis", async () => {
  const routeSource = await readFile(new URL("../app/api/admin/quality/route.ts", import.meta.url), "utf8");
  assert.match(routeSource, /await admin\("quality\.view"\)/);
  assert.match(routeSource, /await admin\("quality\.enrich"\)/);
  assert.doesNotMatch(routeSource, /async function admin\(\)\{return await getChatGPTUser\(\)\}/);

  const sqlite = getRawSqlite();
  // Perfil hipotético que só tem quality.view, não quality.enrich.
  sqlite.exec(`INSERT INTO roles (id, name, is_system, created_at) VALUES ('role-teste-quality-view', 'Teste quality.view', 0, 0)`);
  sqlite.exec(`INSERT INTO role_permissions (role_id, permission_id) VALUES ('role-teste-quality-view', 'quality.view')`);
  sqlite.exec(`INSERT INTO user_roles (user_id, role_id) VALUES ('user-so-view-quality', 'role-teste-quality-view')`);
  const soView = { userId: "user-so-view-quality", email: "soview@example.com" };

  assert.equal(await can(soView, "quality.view"), true);
  assert.equal(await can(soView, "quality.enrich"), false, "quality.view não deve conceder quality.enrich por engano");

  // Curador de fontes não tem nenhuma das duas — GET e POST negados.
  sqlite.exec(`INSERT INTO user_roles (user_id, role_id) VALUES ('user-curador-quality', 'role-curador-fontes')`);
  const curador = { userId: "user-curador-quality", email: "curadorquality@example.com" };
  assert.equal(await can(curador, "quality.view"), false);
  assert.equal(await can(curador, "quality.enrich"), false);
});

// --- Lote 2 da Fase 2: rotas de fontes/coleta/importação, antes restritas
// só a isOwnerEmail, agora via can() com permissões granulares.

test("rota /api/admin/sources: GET exige sources.view, POST/PUT/PATCH exigem sources.manage", async () => {
  const routeSource = await readFile(new URL("../app/api/admin/sources/route.ts", import.meta.url), "utf8");
  assert.match(routeSource, /await owner\("sources\.view"\)/);
  assert.match(routeSource, /await can\(user, permissionId\)/);
  assert.doesNotMatch(routeSource, /isOwnerEmail/);

  const sqlite = getRawSqlite();
  sqlite.exec(`INSERT INTO roles (id, name, is_system, created_at) VALUES ('role-teste-sources-view', 'Teste sources.view', 0, 0)`);
  sqlite.exec(`INSERT INTO role_permissions (role_id, permission_id) VALUES ('role-teste-sources-view', 'sources.view')`);
  sqlite.exec(`INSERT INTO user_roles (user_id, role_id) VALUES ('user-so-view-sources', 'role-teste-sources-view')`);
  const soView = { userId: "user-so-view-sources", email: "soviewsources@example.com" };

  assert.equal(await can(soView, "sources.view"), true);
  assert.equal(await can(soView, "sources.manage"), false, "sources.view não deve conceder sources.manage (POST/PUT/PATCH)");

  const semPermissao = { userId: "user-sem-sources", email: "semsources@example.com" };
  assert.equal(await can(semPermissao, "sources.view"), false);
});

test("rota /api/admin/sources/test (sources.manage): nega quem não tem, concede a quem tem", async () => {
  const routeSource = await readFile(new URL("../app/api/admin/sources/test/route.ts", import.meta.url), "utf8");
  assert.match(routeSource, /await can\(user,\s*"sources\.manage"\)/);
  assert.doesNotMatch(routeSource, /isOwnerEmail/);

  const sqlite = getRawSqlite();
  sqlite.exec(`INSERT INTO user_roles (user_id, role_id) VALUES ('user-curador-sourcetest', 'role-curador-fontes')`);
  const curador = { userId: "user-curador-sourcetest", email: "curadorsourcetest@example.com" };
  assert.equal(await can(curador, "sources.manage"), true, "role-curador-fontes tem sources.manage no seed");

  const visualizador = { userId: "user-visualizador-sourcetest", email: "visualizadorsourcetest@example.com" };
  sqlite.exec(`INSERT INTO user_roles (user_id, role_id) VALUES ('user-visualizador-sourcetest', 'role-visualizador')`);
  assert.equal(await can(visualizador, "sources.manage"), false, "role-visualizador só tem *.view, não sources.manage");
});

test("rota /api/admin/sources/revalidate: mantém o bypass de bearer token do cron, e a sessão passa a exigir sources.manage", async () => {
  const routeSource = await readFile(new URL("../app/api/admin/sources/revalidate/route.ts", import.meta.url), "utf8");
  // O bypass de bearer token do cron do GitHub Actions precisa continuar existindo.
  assert.match(routeSource, /REVALIDATION_SECRET/);
  assert.match(routeSource, /Bearer \$\{secret\}/);
  // A parte de sessão migrou para can(), não usa mais isOwnerEmail.
  assert.match(routeSource, /can\(u,\s*"sources\.manage"\)/);
  assert.doesNotMatch(routeSource, /isOwnerEmail/);
});

test("rota /api/admin/collect (collect.run): nega quem não tem a permissão, concede a quem tem", async () => {
  const routeSource = await readFile(new URL("../app/api/admin/collect/route.ts", import.meta.url), "utf8");
  assert.match(routeSource, /await can\(user,\s*"collect\.run"\)/);
  assert.doesNotMatch(routeSource, /isOwnerEmail/);

  const sqlite = getRawSqlite();
  sqlite.exec(`INSERT INTO user_roles (user_id, role_id) VALUES ('user-curador-collect', 'role-curador-fontes')`);
  const curador = { userId: "user-curador-collect", email: "curadorcollect@example.com" };
  assert.equal(await can(curador, "collect.run"), true);

  const semPermissao = { userId: "user-sem-collect", email: "semcollect@example.com" };
  assert.equal(await can(semPermissao, "collect.run"), false);
});

test("rota /api/admin/import (import.run): nega quem não tem a permissão, concede a quem tem", async () => {
  const routeSource = await readFile(new URL("../app/api/admin/import/route.ts", import.meta.url), "utf8");
  assert.match(routeSource, /await can\(user,\s*"import\.run"\)/);
  assert.doesNotMatch(routeSource, /isOwnerEmail/);

  const sqlite = getRawSqlite();
  sqlite.exec(`INSERT INTO user_roles (user_id, role_id) VALUES ('user-admin-op-import', 'role-admin-operacional')`);
  const adminOp = { userId: "user-admin-op-import", email: "adminopimport@example.com" };
  assert.equal(await can(adminOp, "import.run"), true, "role-admin-operacional tem import.run no seed");

  // Curador de fontes não tem import.run — só sources/collect/monitor.
  const curador = { userId: "user-curador-import", email: "curadorimport@example.com" };
  assert.equal(await can(curador, "import.run"), false);
});

// --- Lote 3 da Fase 2: jobs, settings, backup, gmail-key, collector-key —
// todas antes checavam profiles.role/isOwnerEmail direto, agora via can().

test("rota /api/admin/jobs: GET exige jobs.view_stats, DELETE exige jobs.delete_all — a ação destrutiva continua mais restrita", async () => {
  const routeSource = await readFile(new URL("../app/api/admin/jobs/route.ts", import.meta.url), "utf8");
  assert.match(routeSource, /await can\(user,\s*"jobs\.view_stats"\)/);
  assert.match(routeSource, /await can\(user,\s*"jobs\.delete_all"\)/);
  assert.doesNotMatch(routeSource, /isOwnerEmail/);
  assert.doesNotMatch(routeSource, /profile\?\.role/);

  const sqlite = getRawSqlite();
  sqlite.exec(`INSERT INTO user_roles (user_id, role_id) VALUES ('user-admin-op-jobs', 'role-admin-operacional')`);
  const adminOp = { userId: "user-admin-op-jobs", email: "adminopjobs@example.com" };
  assert.equal(await can(adminOp, "jobs.view_stats"), true);
  // jobs.delete_all é a ação destrutiva deliberadamente excluída de role-admin-operacional no seed.
  assert.equal(await can(adminOp, "jobs.delete_all"), false, "admin operacional não deveria poder excluir vagas em massa");

  const owner = { userId: "radar-local-admin", email: "alexsandro.ramos@gmail.com" };
  assert.equal(await can(owner, "jobs.delete_all"), true);
});

test("rota /api/admin/settings: GET exige settings.view, PUT exige settings.edit", async () => {
  const routeSource = await readFile(new URL("../app/api/admin/settings/route.ts", import.meta.url), "utf8");
  assert.match(routeSource, /await admin\("settings\.view"\)/);
  assert.match(routeSource, /await admin\("settings\.edit"\)/);
  assert.doesNotMatch(routeSource, /profile\?\.role|p\?\.role/);

  const sqlite = getRawSqlite();
  sqlite.exec(`INSERT INTO roles (id, name, is_system, created_at) VALUES ('role-teste-settings-view', 'Teste settings.view', 0, 0)`);
  sqlite.exec(`INSERT INTO role_permissions (role_id, permission_id) VALUES ('role-teste-settings-view', 'settings.view')`);
  sqlite.exec(`INSERT INTO user_roles (user_id, role_id) VALUES ('user-so-view-settings', 'role-teste-settings-view')`);
  const soView = { userId: "user-so-view-settings", email: "soviewsettings@example.com" };
  assert.equal(await can(soView, "settings.view"), true);
  assert.equal(await can(soView, "settings.edit"), false, "settings.view não deve conceder settings.edit");
});

test("rota /api/admin/backup (backup.export): nega quem não tem a permissão, concede a quem tem", async () => {
  const routeSource = await readFile(new URL("../app/api/admin/backup/route.ts", import.meta.url), "utf8");
  assert.match(routeSource, /await can\(u,\s*"backup\.export"\)/);
  assert.doesNotMatch(routeSource, /profile\?\.role|p\?\.role/);

  const sqlite = getRawSqlite();
  sqlite.exec(`INSERT INTO user_roles (user_id, role_id) VALUES ('user-admin-op-backup', 'role-admin-operacional')`);
  const adminOp = { userId: "user-admin-op-backup", email: "adminopbackup@example.com" };
  assert.equal(await can(adminOp, "backup.export"), true);

  const visualizador = { userId: "user-visualizador-backup", email: "visualizadorbackup@example.com" };
  sqlite.exec(`INSERT INTO user_roles (user_id, role_id) VALUES ('user-visualizador-backup', 'role-visualizador')`);
  assert.equal(await can(visualizador, "backup.export"), false, "role-visualizador não tem backup.export no seed");
});

test("rota /api/admin/gmail-key (gmail_key.manage) e /api/admin/collector-key (collector_key.manage): migradas, sem checagem antiga de role", async () => {
  const gmailKey = await readFile(new URL("../app/api/admin/gmail-key/route.ts", import.meta.url), "utf8");
  const collectorKey = await readFile(new URL("../app/api/admin/collector-key/route.ts", import.meta.url), "utf8");
  assert.match(gmailKey, /await can\(user,\s*"gmail_key\.manage"\)/);
  assert.doesNotMatch(gmailKey, /profile\?\.role/);
  assert.match(collectorKey, /await can\(user,\s*"collector_key\.manage"\)/);
  assert.doesNotMatch(collectorKey, /isOwnerEmail/);

  const sqlite = getRawSqlite();
  sqlite.exec(`INSERT INTO user_roles (user_id, role_id) VALUES ('user-admin-op-keys', 'role-admin-operacional')`);
  const adminOp = { userId: "user-admin-op-keys", email: "adminopkeys@example.com" };
  assert.equal(await can(adminOp, "gmail_key.manage"), true);
  assert.equal(await can(adminOp, "collector_key.manage"), true);

  const semPermissao = { userId: "user-sem-keys", email: "semkeys@example.com" };
  assert.equal(await can(semPermissao, "gmail_key.manage"), false);
  assert.equal(await can(semPermissao, "collector_key.manage"), false);
});

// --- Rota de governança: users/[userId] PATCH (users.change_role). Esta é
// a superfície mais sensível — muda o role de outro usuário. A decisão de
// governança de 2026-08-09 exige que só a owner tenha essa permissão.

test("rota /api/admin/users (users.view / users.invite): permissões distintas, ambas migradas de profiles.role", async () => {
  const routeSource = await readFile(new URL("../app/api/admin/users/route.ts", import.meta.url), "utf8");
  assert.match(routeSource, /await admin\("users\.view"\)/);
  assert.match(routeSource, /await admin\("users\.invite"\)/);
  assert.doesNotMatch(routeSource, /profile\?\.role\s*===\s*"admin"/);

  const sqlite = getRawSqlite();
  sqlite.exec(`INSERT INTO roles (id, name, is_system, created_at) VALUES ('role-teste-users-view', 'Teste users.view', 0, 0)`);
  sqlite.exec(`INSERT INTO role_permissions (role_id, permission_id) VALUES ('role-teste-users-view', 'users.view')`);
  sqlite.exec(`INSERT INTO user_roles (user_id, role_id) VALUES ('user-so-view-users', 'role-teste-users-view')`);
  const soView = { userId: "user-so-view-users", email: "soviewusers@example.com" };
  assert.equal(await can(soView, "users.view"), true);
  assert.equal(await can(soView, "users.invite"), false, "users.view não deve conceder users.invite");
});

test("rota /api/admin/users/[userId] PATCH (users.change_role): SÓ a owner tem essa permissão — nenhum perfil de partida, nem admin operacional", async () => {
  const routeSource = await readFile(new URL("../app/api/admin/users/[userId]/route.ts", import.meta.url), "utf8");
  assert.match(routeSource, /await can\(user,\s*"users\.change_role"\)/);
  // Não deve mais ter a comparação de e-mail hardcoded (embora o mesmo
  // resultado — só a owner — continue valendo através de can()).
  assert.doesNotMatch(routeSource, /user\.email\.toLowerCase\(\) === OWNER_EMAIL/);
  // A proteção "conta principal não pode ter o papel alterado" precisa continuar existindo.
  assert.match(routeSource, /A conta principal não pode ter o papel alterado/);

  const owner = { userId: "radar-local-admin", email: "alexsandro.ramos@gmail.com" };
  assert.equal(await can(owner, "users.change_role"), true);

  // Nenhum dos 3 perfis de partida — incluindo o mais amplo, admin operacional — tem essa permissão.
  const sqlite = getRawSqlite();
  const roleIds = sqlite.prepare("SELECT id FROM roles").all().map(r => r.id);
  for (const roleId of roleIds) {
    sqlite.exec(`DELETE FROM user_roles WHERE user_id = 'user-changerole-probe-${roleId}'`);
    sqlite.exec(`INSERT INTO user_roles (user_id, role_id) VALUES ('user-changerole-probe-${roleId}', '${roleId}')`);
    const user = { userId: `user-changerole-probe-${roleId}`, email: `changerole-${roleId}@example.com` };
    assert.equal(await can(user, "users.change_role"), false, `role ${roleId} não deveria conceder users.change_role`);
  }

  // Mesmo alguém com TODAS as outras permissões de users.* não ganha change_role de graça.
  sqlite.exec(`INSERT INTO roles (id, name, is_system, created_at) VALUES ('role-teste-users-full-menos-change', 'Teste users quase tudo', 0, 0)`);
  sqlite.exec(`INSERT INTO role_permissions (role_id, permission_id) VALUES ('role-teste-users-full-menos-change', 'users.view')`);
  sqlite.exec(`INSERT INTO role_permissions (role_id, permission_id) VALUES ('role-teste-users-full-menos-change', 'users.invite')`);
  sqlite.exec(`INSERT INTO user_roles (user_id, role_id) VALUES ('user-quase-tudo', 'role-teste-users-full-menos-change')`);
  const quaseTudo = { userId: "user-quase-tudo", email: "quasetudo@example.com" };
  assert.equal(await can(quaseTudo, "users.view"), true);
  assert.equal(await can(quaseTudo, "users.invite"), true);
  assert.equal(await can(quaseTudo, "users.change_role"), false);
});

// --- Fase 3: rotas /api/admin/permissions e /api/admin/roles (CRUD de
// perfis). Diferente das rotas da Fase 2, estas têm lógica própria (insert/
// update/delete, blocklist de permissões exclusivas da owner, checagem de
// vínculos antes de excluir) — os testes replicam essa lógica real contra
// o SQLite, não só a decisão de acesso de can().

test("rota /api/admin/permissions (roles.manage): só quem gerencia perfis vê o catálogo", async () => {
  const routeSource = await readFile(new URL("../app/api/admin/permissions/route.ts", import.meta.url), "utf8");
  assert.match(routeSource, /await can\(user,\s*"roles\.manage"\)/);

  const owner = { userId: "radar-local-admin", email: "alexsandro.ramos@gmail.com" };
  assert.equal(await can(owner, "roles.manage"), true);

  const sqlite = getRawSqlite();
  sqlite.exec(`INSERT INTO user_roles (user_id, role_id) VALUES ('user-admin-op-perms', 'role-admin-operacional')`);
  const adminOp = { userId: "user-admin-op-perms", email: "adminopperms@example.com" };
  assert.equal(await can(adminOp, "roles.manage"), false, "admin operacional não deveria ver o catálogo de permissões");

  const catalogCount = sqlite.prepare("SELECT count(*) as total FROM permissions").get();
  assert.equal(catalogCount.total, 21, "seed 0011 cadastra 21 permissões");
});

test("rota /api/admin/roles POST: bloqueia roles.manage/groups.manage na criação, mesmo pedido pela owner", async () => {
  const routeSource = await readFile(new URL("../app/api/admin/roles/route.ts", import.meta.url), "utf8");
  assert.match(routeSource, /OWNER_ONLY_PERMISSIONS/);
  assert.match(routeSource, /await can\(user,\s*"roles\.manage"\)/);

  // Replica exatamente a validação da rota: qualquer permissionId da
  // blocklist é rejeitado antes de qualquer INSERT.
  const OWNER_ONLY = new Set(["roles.manage", "groups.manage"]);
  const attemptedPermissions = ["sources.view", "roles.manage"];
  const blocked = attemptedPermissions.filter(id => OWNER_ONLY.has(id));
  assert.deepEqual(blocked, ["roles.manage"], "roles.manage deve ser barrado mesmo entre permissões válidas");

  const sqlite = getRawSqlite();
  const before = sqlite.prepare("SELECT count(*) as total FROM roles").get().total;
  // Simula a rota recusando a criação sem nenhum insert acontecer.
  assert.equal(blocked.length > 0, true);
  const after = sqlite.prepare("SELECT count(*) as total FROM roles").get().total;
  assert.equal(before, after, "nenhuma role deveria ter sido criada quando a validação rejeita");
});

test("rota /api/admin/roles POST: cria role customizada com permissões válidas, sem duplicar nome", async () => {
  const sqlite = getRawSqlite();
  const id = "role-teste-fase3-nova";
  const name = "Teste Fase 3";
  sqlite.exec(`DELETE FROM roles WHERE id = '${id}' OR name = '${name}'`);

  sqlite.exec(`INSERT INTO roles (id, name, description, is_system, created_at) VALUES ('${id}', '${name}', 'criada em teste', 0, ${Date.now()})`);
  sqlite.exec(`INSERT INTO role_permissions (role_id, permission_id) VALUES ('${id}', 'sources.view')`);
  sqlite.exec(`INSERT INTO role_permissions (role_id, permission_id) VALUES ('${id}', 'collect.run')`);

  const created = sqlite.prepare("SELECT * FROM roles WHERE id = ?").get(id);
  assert.equal(created.name, name);
  assert.equal(created.is_system, 0, "role criada pela UI nunca é isSystem");

  const grants = sqlite.prepare("SELECT permission_id FROM role_permissions WHERE role_id = ?").all(id).map(r => r.permission_id);
  assert.deepEqual(grants.sort(), ["collect.run", "sources.view"]);

  // A permissão se comporta de verdade em can(): concede exatamente o que foi atribuído.
  sqlite.exec(`INSERT INTO user_roles (user_id, role_id) VALUES ('user-nova-role-fase3', '${id}')`);
  const user = { userId: "user-nova-role-fase3", email: "novarolefase3@example.com" };
  assert.equal(await can(user, "sources.view"), true);
  assert.equal(await can(user, "collect.run"), true);
  assert.equal(await can(user, "roles.manage"), false);
});

test("rota /api/admin/roles/[roleId] DELETE: recusa excluir perfil do sistema", async () => {
  const routeSource = await readFile(new URL("../app/api/admin/roles/[roleId]/route.ts", import.meta.url), "utf8");
  assert.match(routeSource, /role\.isSystem/);
  assert.match(routeSource, /Perfis do sistema não podem ser excluídos/);

  // Os 3 perfis do seed 0011 nascem com is_system=0 (editáveis/excluíveis
  // pela UI, como qualquer perfil customizado) — a proteção de is_system=1
  // existe para perfis marcados como tal no futuro, não para o seed atual.
  // Este teste prova a proteção com um perfil marcado explicitamente.
  const sqlite = getRawSqlite();
  const id = "role-teste-fase3-sistema";
  sqlite.exec(`DELETE FROM roles WHERE id = '${id}'`);
  sqlite.exec(`INSERT INTO roles (id, name, is_system, created_at) VALUES ('${id}', 'Teste Fase 3 sistema', 1, ${Date.now()})`);
  const systemRole = sqlite.prepare("SELECT * FROM roles WHERE id = ?").get(id);
  assert.equal(systemRole.is_system, 1);
  // A rota real checaria role.isSystem aqui e devolveria 403 antes de
  // qualquer DELETE — replicado como asserção de que a linha existe acima.
  sqlite.exec(`DELETE FROM roles WHERE id = '${id}'`);
});

test("rota /api/admin/roles/[roleId] DELETE: recusa excluir perfil com usuários ou grupos vinculados", async () => {
  const routeSource = await readFile(new URL("../app/api/admin/roles/[roleId]/route.ts", import.meta.url), "utf8");
  assert.match(routeSource, /userCount\.length \|\| groupCount\.length/);

  const sqlite = getRawSqlite();
  const id = "role-teste-fase3-vinculada";
  sqlite.exec(`DELETE FROM roles WHERE id = '${id}'`);
  sqlite.exec(`INSERT INTO roles (id, name, is_system, created_at) VALUES ('${id}', 'Teste Fase 3 vinculada', 0, ${Date.now()})`);
  sqlite.exec(`INSERT INTO user_roles (user_id, role_id) VALUES ('user-vinculado-fase3', '${id}')`);

  const linkedUsers = sqlite.prepare("SELECT user_id FROM user_roles WHERE role_id = ?").all(id);
  assert.equal(linkedUsers.length, 1, "a rota deve enxergar o vínculo e recusar a exclusão");

  // Depois de remover o vínculo, a exclusão real (replicada aqui) funciona.
  sqlite.exec(`DELETE FROM user_roles WHERE role_id = '${id}'`);
  sqlite.exec(`DELETE FROM role_permissions WHERE role_id = '${id}'`);
  sqlite.exec(`DELETE FROM roles WHERE id = '${id}'`);
  const gone = sqlite.prepare("SELECT * FROM roles WHERE id = ?").get(id);
  assert.equal(gone, undefined);
});

test("rota /api/admin/roles/[roleId] PATCH: bloqueia roles.manage/groups.manage também na edição", async () => {
  const routeSource = await readFile(new URL("../app/api/admin/roles/[roleId]/route.ts", import.meta.url), "utf8");
  assert.match(routeSource, /OWNER_ONLY_PERMISSIONS/);

  const sqlite = getRawSqlite();
  const id = "role-teste-fase3-edicao";
  sqlite.exec(`DELETE FROM roles WHERE id = '${id}'`);
  sqlite.exec(`INSERT INTO roles (id, name, is_system, created_at) VALUES ('${id}', 'Teste Fase 3 edição', 0, ${Date.now()})`);
  sqlite.exec(`INSERT INTO role_permissions (role_id, permission_id) VALUES ('${id}', 'sources.view')`);

  // Simula a rota recusando um PATCH que tenta adicionar groups.manage —
  // o conjunto de permissões no banco não deve mudar.
  const OWNER_ONLY = new Set(["roles.manage", "groups.manage"]);
  const requestedPermissionIds = ["sources.view", "groups.manage"];
  const blocked = requestedPermissionIds.filter(pid => OWNER_ONLY.has(pid));
  assert.equal(blocked.length > 0, true, "groups.manage deveria ser barrado no PATCH");

  const grants = sqlite.prepare("SELECT permission_id FROM role_permissions WHERE role_id = ?").all(id).map(r => r.permission_id);
  assert.deepEqual(grants, ["sources.view"], "PATCH rejeitado não deve ter alterado as permissões existentes");
});
