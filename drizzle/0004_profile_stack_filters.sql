ALTER TABLE profiles ADD COLUMN required_stacks text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE profiles ADD COLUMN stack_match_mode text DEFAULT 'all' NOT NULL;
--> statement-breakpoint
PRAGMA optimize;
