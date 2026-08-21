CREATE TABLE IF NOT EXISTS `company_contacts` (
	`company_key` text PRIMARY KEY NOT NULL,
	`company_name` text NOT NULL,
	`contact_email` text NOT NULL,
	`contact_subject` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
