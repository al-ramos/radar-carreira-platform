CREATE TABLE `user_job_analyses` (
  `user_id` text NOT NULL,
  `job_id` text NOT NULL,
  `profile_version` integer NOT NULL,
  `verdict` text NOT NULL,
  `label` text NOT NULL,
  `blocker` text,
  `rows` text NOT NULL DEFAULT '[]',
  `matching_skills` text NOT NULL DEFAULT '[]',
  `missing_skills` text NOT NULL DEFAULT '[]',
  `source` text NOT NULL DEFAULT 'rules',
  `confidence` integer NOT NULL DEFAULT 100,
  `explanation` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  PRIMARY KEY (`user_id`, `job_id`),
  FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
