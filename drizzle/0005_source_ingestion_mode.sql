ALTER TABLE `job_sources` ADD `collection_mode` text DEFAULT 'push' NOT NULL;
--> statement-breakpoint
UPDATE `job_sources` SET `collection_mode` = 'pull' WHERE `provider` IN ('greenhouse', 'lever', 'ashby');
