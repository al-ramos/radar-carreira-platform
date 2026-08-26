-- Confirmação explícita do proprietário: vagas aprovadas e elegíveis devem
-- acionar a criação do rascunho imediatamente, sem aguardar uma fila manual.
UPDATE `platform_settings`
SET `scheduled_triage_draft_queue_enabled` = true,
    `scheduled_triage_auto_create_enabled` = true,
    `updated_at` = unixepoch() * 1000
WHERE `id` = 'global';
