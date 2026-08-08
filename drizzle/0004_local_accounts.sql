CREATE TABLE `local_accounts` (
  `user_id` text PRIMARY KEY NOT NULL,
  `email` text NOT NULL,
  `name` text,
  `password_hash` text NOT NULL,
  `password_salt` text NOT NULL,
  `created_by` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `local_accounts_email_unique` ON `local_accounts` (`email`);
