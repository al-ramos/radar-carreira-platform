ALTER TABLE `draft_outbox` ADD `draft_subject` text;
--> statement-breakpoint
ALTER TABLE `draft_outbox` ADD `gmail_sent_id` text;
--> statement-breakpoint
ALTER TABLE `draft_outbox` ADD `sent_at` integer;
--> statement-breakpoint
CREATE UNIQUE INDEX `draft_outbox_gmail_sent_unique` ON `draft_outbox` (`gmail_sent_id`);
