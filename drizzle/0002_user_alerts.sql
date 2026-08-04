CREATE TABLE alert_preferences (
  user_id text PRIMARY KEY NOT NULL,
  enabled integer DEFAULT true NOT NULL,
  min_score integer DEFAULT 80 NOT NULL,
  frequency text DEFAULT 'daily' NOT NULL,
  updated_at integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE alert_reads (
  user_id text NOT NULL,
  job_id text NOT NULL,
  read_at integer NOT NULL,
  PRIMARY KEY(user_id, job_id),
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);
--> statement-breakpoint
CREATE INDEX idx_alert_reads_user ON alert_reads(user_id);
--> statement-breakpoint
PRAGMA optimize;
