ALTER TABLE `platform_settings` ADD `queue_daily_operation_budget` integer NOT NULL DEFAULT 7500;
ALTER TABLE `platform_settings` ADD `manual_queue_message_size` integer NOT NULL DEFAULT 25;
ALTER TABLE `platform_settings` ADD `ai_review_chunk_size` integer NOT NULL DEFAULT 10;
