import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const profiles = sqliteTable("profiles", {
  userId: text("user_id").primaryKey(), email: text("email").notNull(), name: text("name"),
  role: text("role", { enum: ["user", "admin"] }).notNull().default("user"), seniority: text("seniority"),
  preferredMode: text("preferred_mode"), cities: text("cities").notNull().default("[]"),
  masteredSkills: text("mastered_skills").notNull().default("[]"), desiredAreas: text("desired_areas").notNull().default("[]"),
  avoidTerms: text("avoid_terms").notNull().default("[]"), minScore: integer("min_score").notNull().default(60),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const jobSources = sqliteTable("job_sources", {
  id: text("id").primaryKey(), name: text("name").notNull(),
  provider: text("provider", { enum: ["greenhouse", "lever", "ashby", "jsonld", "jsonfeed", "manual"] }).notNull(),
  externalRef: text("external_ref").notNull(), enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastRunAt: integer("last_run_at", { mode: "timestamp_ms" }), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(), fingerprint: text("fingerprint").notNull(), sourceId: text("source_id").references(() => jobSources.id),
  externalId: text("external_id"), company: text("company").notNull(), title: text("title").notNull(), seniority: text("seniority"),
  workMode: text("work_mode"), location: text("location"), stack: text("stack").notNull().default("[]"),
  publishedAt: integer("published_at", { mode: "timestamp_ms" }), url: text("url").notNull(), description: text("description").notNull().default(""),
  firstSeenAt: integer("first_seen_at", { mode: "timestamp_ms" }).notNull(), lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
  status: text("status", { enum: ["active", "possibly_closed", "closed"] }).notNull().default("active"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, t => [uniqueIndex("jobs_fingerprint_unique").on(t.fingerprint)]);

export const userJobStatus = sqliteTable("user_job_status", {
  userId: text("user_id").notNull(), jobId: text("job_id").notNull().references(() => jobs.id),
  stage: text("stage", { enum: ["new", "saved", "applied", "interview", "offer", "rejected", "archived"] }).notNull().default("new"),
  note: text("note"), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, t => [primaryKey({ columns: [t.userId, t.jobId] })]);

export const jobEvents = sqliteTable("job_events", {
  id: integer("id").primaryKey({ autoIncrement: true }), jobId: text("job_id").notNull().references(() => jobs.id),
  type: text("type").notNull(), detail: text("detail"), occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull(),
});

export const importRuns = sqliteTable("import_runs", {
  id: text("id").primaryKey(), source: text("source").notNull(), status: text("status", { enum: ["running", "completed", "failed"] }).notNull(),
  received: integer("received").notNull().default(0), inserted: integer("inserted").notNull().default(0), updated: integer("updated").notNull().default(0),
  duplicates: integer("duplicates").notNull().default(0), errors: integer("errors").notNull().default(0), actorUserId: text("actor_user_id"),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(), finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
});
