CREATE TABLE `job_ai_facts` (
  `job_id` text PRIMARY KEY NOT NULL,
  `description_hash` text NOT NULL,
  `analyzer_version` text NOT NULL,
  `facts` text NOT NULL,
  `provider` text NOT NULL,
  `model` text NOT NULL,
  `input_tokens` integer NOT NULL DEFAULT 0,
  `output_tokens` integer NOT NULL DEFAULT 0,
  `analyzed_at` integer NOT NULL,
  FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `ai_usage_events` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `job_id` text,
  `operation` text NOT NULL,
  `provider` text NOT NULL,
  `model` text NOT NULL,
  `input_tokens` integer NOT NULL DEFAULT 0,
  `output_tokens` integer NOT NULL DEFAULT 0,
  `status` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ai_usage_user_created_idx` ON `ai_usage_events` (`user_id`,`created_at`);
