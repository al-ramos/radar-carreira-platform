CREATE TABLE alert_deliveries (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL,
  channel text DEFAULT 'email' NOT NULL,
  period_key text NOT NULL,
  status text DEFAULT 'prepared' NOT NULL,
  job_count integer DEFAULT 0 NOT NULL,
  created_at integer NOT NULL,
  sent_at integer
);
--> statement-breakpoint
CREATE INDEX idx_alert_deliveries_user_created ON alert_deliveries(user_id, created_at);
--> statement-breakpoint
PRAGMA optimize;
