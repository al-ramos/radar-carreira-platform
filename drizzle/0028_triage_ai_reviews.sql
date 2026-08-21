CREATE TABLE `triage_ai_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`prompt` text NOT NULL,
	`selection` text NOT NULL,
	`response` text,
	`status` text NOT NULL DEFAULT 'running',
	`error` text,
	`provider` text,
	`model` text,
	`input_tokens` integer NOT NULL DEFAULT 0,
	`output_tokens` integer NOT NULL DEFAULT 0,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `triage_ai_reviews_user_created_idx` ON `triage_ai_reviews` (`user_id`,`created_at`);
