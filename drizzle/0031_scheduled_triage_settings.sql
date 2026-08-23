ALTER TABLE `platform_settings` ADD COLUMN `scheduled_triage_enabled` integer DEFAULT false NOT NULL;
ALTER TABLE `platform_settings` ADD COLUMN `scheduled_triage_draft_queue_enabled` integer DEFAULT false NOT NULL;
