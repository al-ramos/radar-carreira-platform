-- A autorização explícita de 2026-08-31 vale somente para novas decisões e
-- ações posteriores à publicação. Rascunhos já existentes permanecem sem
-- autorização automática para evitar qualquer envio retroativo.
ALTER TABLE `draft_outbox` ADD COLUMN `auto_send_authorized` integer DEFAULT false NOT NULL;
ALTER TABLE `draft_outbox` ADD COLUMN `auto_send_authorized_at` integer;
