CREATE TABLE platform_settings (
  id text PRIMARY KEY DEFAULT 'global' NOT NULL,
  collection_enabled integer DEFAULT true NOT NULL,
  email_import_enabled integer DEFAULT true NOT NULL,
  enrichment_enabled integer DEFAULT true NOT NULL,
  default_period text DEFAULT '24' NOT NULL,
  default_min_score integer DEFAULT 70 NOT NULL,
  stale_after_days integer DEFAULT 7 NOT NULL,
  retention_days integer DEFAULT 180 NOT NULL,
  updated_by text,
  updated_at integer NOT NULL
);
--> statement-breakpoint
PRAGMA optimize;
