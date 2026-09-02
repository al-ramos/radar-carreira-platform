ALTER TABLE `jobs` ADD `triage_input_updated_at` integer NOT NULL DEFAULT 0;

UPDATE `jobs`
SET `triage_input_updated_at` = `updated_at`;

CREATE INDEX `triage_history_current_version_idx`
ON `triage_history` (`user_id`, `job_id`, `profile_revision`, `rules_revision`, `instructions_revision`, `created_at`);

-- Revoga autorizações implícitas deixadas por versões anteriores. Rascunhos
-- continuam preservados; somente um clique explícito no portal pode voltar a
-- autorizar o envio.
UPDATE `draft_outbox`
SET `auto_send_authorized` = false,
    `auto_send_authorized_at` = NULL
WHERE `status` IN ('pending', 'checking', 'drafted', 'failed');
