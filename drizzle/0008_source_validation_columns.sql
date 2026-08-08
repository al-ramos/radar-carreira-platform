ALTER TABLE `job_sources` ADD `validation_status` text;
--> statement-breakpoint
ALTER TABLE `job_sources` ADD `found_name` text;
--> statement-breakpoint
ALTER TABLE `job_sources` ADD `last_validated` integer;
