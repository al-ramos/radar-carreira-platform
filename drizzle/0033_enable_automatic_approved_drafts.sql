-- Confirmação explícita do proprietário: criar automaticamente rascunhos
-- (nunca enviar e-mails) para vagas aprovadas com e-mail de contato válido.
UPDATE `platform_settings`
SET `scheduled_triage_draft_queue_enabled` = true,
    `scheduled_triage_auto_create_enabled` = true,
    `updated_at` = unixepoch() * 1000
WHERE `id` = 'global';
