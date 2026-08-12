ALTER TABLE `user_job_status` ADD `application_status` text;
--> statement-breakpoint
ALTER TABLE `user_job_status` ADD `generated_at` integer;
--> statement-breakpoint
ALTER TABLE `user_job_status` ADD `sent_at` integer;
--> statement-breakpoint
ALTER TABLE `user_job_status` ADD `responded_at` integer;
