CREATE TABLE IF NOT EXISTS `job_ai_triage` (
	`job_id` text PRIMARY KEY NOT NULL,
	`processed_at` integer NOT NULL,
	`veredito` text NOT NULL,
	`motivo` text,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
