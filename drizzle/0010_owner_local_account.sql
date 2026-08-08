-- Migration 0010: garante que a tabela local_accounts existe e tem role de owner
-- NÃO insere credenciais. A conta do owner é criada via script de bootstrap
-- (scripts/bootstrap-owner.mjs) que nunca armazena senha no histórico do Git.

-- Adiciona coluna role à tabela local_accounts (caso não exista ainda)
ALTER TABLE `local_accounts` ADD COLUMN `role` text NOT NULL DEFAULT 'owner';
--> statement-breakpoint

-- Garante índice único no email (idempotente)
CREATE UNIQUE INDEX IF NOT EXISTS `local_accounts_email_unique` ON `local_accounts` (`email`);
