-- Catálogo fixo de permissões (id = "modulo.acao"), mapeado às rotas
-- /api/admin/* já existentes no projeto. Ver README/docs para a tabela
-- completa de rota -> permissão.
INSERT INTO `permissions` (`id`, `module`, `description`) VALUES
	('sources.view', 'sources', 'Ver fontes de vagas cadastradas'),
	('sources.manage', 'sources', 'Criar, editar, testar e revalidar fontes de vagas'),
	('collect.run', 'collect', 'Disparar coleta manual de vagas'),
	('import.run', 'import', 'Importar vagas via JSON ou CSV'),
	('jobs.view_stats', 'jobs', 'Ver estatísticas de vagas ativas/encerradas'),
	('jobs.delete_all', 'jobs', 'Excluir vagas em massa (ação destrutiva)'),
	('settings.view', 'settings', 'Ver configurações da plataforma'),
	('settings.edit', 'settings', 'Editar configurações da plataforma'),
	('monitor.view', 'monitor', 'Ver painel de monitoramento de coletas'),
	('quality.view', 'quality', 'Ver relatório de qualidade dos dados'),
	('quality.enrich', 'quality', 'Disparar enriquecimento de vagas do LinkedIn'),
	('audit.view', 'audit', 'Ver linha do tempo de auditoria'),
	('backup.export', 'backup', 'Exportar backup completo dos dados'),
	('report.export', 'report', 'Exportar relatório de vagas em CSV/Excel'),
	('gmail_key.manage', 'integrations', 'Gerenciar chave de integração Gmail/RadarVagas'),
	('collector_key.manage', 'integrations', 'Gerenciar chave da extensão de coleta LinkedIn'),
	('users.view', 'users', 'Ver lista de usuários cadastrados'),
	('users.invite', 'users', 'Convidar novos usuários'),
	('users.change_role', 'users', 'Promover ou rebaixar usuários entre admin/user'),
	('roles.manage', 'rbac', 'Criar, editar e excluir perfis (roles) e suas permissões'),
	('groups.manage', 'rbac', 'Criar, editar e excluir grupos e suas atribuições');
--> statement-breakpoint

-- Perfis de partida. Nenhum deles é atribuído automaticamente a ninguém
-- nesta migration — a atribuição é feita depois, pela aba Usuários/Perfis.
INSERT INTO `roles` (`id`, `name`, `description`, `is_system`, `created_at`) VALUES
	('role-admin-operacional', 'Admin operacional', 'Acesso amplo às operações do dia a dia, sem gerenciar perfis, grupos, papéis de outros usuários nem excluir vagas em massa.', 0, 1786550400000),
	('role-curador-fontes', 'Curador de fontes', 'Cuida do cadastro e da saúde das fontes de vagas: visualizar, gerenciar, coletar e monitorar.', 0, 1786550400000),
	('role-visualizador', 'Visualizador', 'Acesso somente leitura às telas administrativas, sem nenhuma ação de escrita.', 0, 1786550400000);
--> statement-breakpoint

-- Admin operacional: tudo exceto roles.manage, groups.manage,
-- users.change_role e jobs.delete_all.
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES
	('role-admin-operacional', 'sources.view'),
	('role-admin-operacional', 'sources.manage'),
	('role-admin-operacional', 'collect.run'),
	('role-admin-operacional', 'import.run'),
	('role-admin-operacional', 'jobs.view_stats'),
	('role-admin-operacional', 'settings.view'),
	('role-admin-operacional', 'settings.edit'),
	('role-admin-operacional', 'monitor.view'),
	('role-admin-operacional', 'quality.view'),
	('role-admin-operacional', 'quality.enrich'),
	('role-admin-operacional', 'audit.view'),
	('role-admin-operacional', 'backup.export'),
	('role-admin-operacional', 'report.export'),
	('role-admin-operacional', 'gmail_key.manage'),
	('role-admin-operacional', 'collector_key.manage'),
	('role-admin-operacional', 'users.view'),
	('role-admin-operacional', 'users.invite');
--> statement-breakpoint

-- Curador de fontes: só o necessário para cuidar das fontes de coleta.
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES
	('role-curador-fontes', 'sources.view'),
	('role-curador-fontes', 'sources.manage'),
	('role-curador-fontes', 'collect.run'),
	('role-curador-fontes', 'monitor.view');
--> statement-breakpoint

-- Visualizador: só as permissões *.view.
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES
	('role-visualizador', 'sources.view'),
	('role-visualizador', 'jobs.view_stats'),
	('role-visualizador', 'settings.view'),
	('role-visualizador', 'monitor.view'),
	('role-visualizador', 'quality.view'),
	('role-visualizador', 'audit.view'),
	('role-visualizador', 'users.view');
