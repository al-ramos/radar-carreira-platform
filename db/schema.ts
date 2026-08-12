import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const profiles = sqliteTable("profiles", {
  userId: text("user_id").primaryKey(), email: text("email").notNull(), name: text("name"),
  role: text("role", { enum: ["user", "admin"] }).notNull().default("user"), seniority: text("seniority"),
  preferredMode: text("preferred_mode"), cities: text("cities").notNull().default("[]"),
  masteredSkills: text("mastered_skills").notNull().default("[]"), desiredAreas: text("desired_areas").notNull().default("[]"),
  avoidTerms: text("avoid_terms").notNull().default("[]"), minScore: integer("min_score").notNull().default(60),
  careerRules: text("career_rules").notNull().default("{}"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const localAccounts = sqliteTable("local_accounts", {
  userId: text("user_id").primaryKey(), email: text("email").notNull(), name: text("name"),
  passwordHash: text("password_hash").notNull(), passwordSalt: text("password_salt").notNull(),
  createdBy: text("created_by"), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, table => [uniqueIndex("local_accounts_email_unique").on(table.email)]);

export const jobSources = sqliteTable("job_sources", {
  id: text("id").primaryKey(), name: text("name").notNull(),
  provider: text("provider", { enum: ["greenhouse", "lever", "ashby", "jsonld", "jsonfeed", "manual"] }).notNull(),
  collectionMode: text("collection_mode", { enum: ["pull", "push"] }).notNull().default("push"),
  externalRef: text("external_ref").notNull(), enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastRunAt: integer("last_run_at", { mode: "timestamp_ms" }), lastAttemptAt: integer("last_attempt_at", { mode: "timestamp_ms" }),
  lastSuccessAt: integer("last_success_at", { mode: "timestamp_ms" }), lastError: text("last_error"), consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  validationStatus: text("validation_status", { enum: ["ok", "empty", "mismatch", "error"] }),
  foundName: text("found_name"),
  lastValidated: integer("last_validated", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(), fingerprint: text("fingerprint").notNull(), sourceId: text("source_id").references(() => jobSources.id),
  externalId: text("external_id"), company: text("company").notNull(), title: text("title").notNull(), seniority: text("seniority"),
  workMode: text("work_mode"), location: text("location"), stack: text("stack").notNull().default("[]"),
  publishedAt: integer("published_at", { mode: "timestamp_ms" }), url: text("url").notNull(), applyUrl: text("apply_url"),
  contactEmail: text("contact_email"), contactSubject: text("contact_subject"), description: text("description").notNull().default(""),
  firstSeenAt: integer("first_seen_at", { mode: "timestamp_ms" }).notNull(), lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
  status: text("status", { enum: ["active", "possibly_closed", "closed"] }).notNull().default("active"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, t => [uniqueIndex("jobs_fingerprint_unique").on(t.fingerprint)]);

export const userJobStatus = sqliteTable("user_job_status", {
  userId: text("user_id").notNull(), jobId: text("job_id").notNull().references(() => jobs.id),
  stage: text("stage", { enum: ["viewed", "saved", "applied", "interview", "rejected", "archived"] }).notNull().default("viewed"),
  note: text("note"),
  applicationStatus: text("application_status", { enum: ["generated", "sent", "responded"] }),
  generatedAt: integer("generated_at", { mode: "timestamp_ms" }),
  sentAt: integer("sent_at", { mode: "timestamp_ms" }),
  respondedAt: integer("responded_at", { mode: "timestamp_ms" }),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, t => [primaryKey({ columns: [t.userId, t.jobId] })]);

export const userJobAnalyses = sqliteTable("user_job_analyses", {
  userId: text("user_id").notNull(),
  jobId: text("job_id").notNull().references(() => jobs.id),
  profileVersion: integer("profile_version", { mode: "timestamp_ms" }).notNull(),
  verdict: text("verdict", { enum: ["✅", "🟡", "🔴", "❌"] }).notNull(),
  label: text("label").notNull(),
  blocker: text("blocker"),
  rows: text("rows").notNull().default("[]"),
  matchingSkills: text("matching_skills").notNull().default("[]"),
  missingSkills: text("missing_skills").notNull().default("[]"),
  source: text("source", { enum: ["rules", "ai"] }).notNull().default("rules"),
  confidence: integer("confidence").notNull().default(100),
  explanation: text("explanation"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, t => [primaryKey({ columns: [t.userId, t.jobId] })]);

export const jobAiFacts = sqliteTable("job_ai_facts", {
  jobId: text("job_id").primaryKey().references(() => jobs.id),
  descriptionHash: text("description_hash").notNull(),
  analyzerVersion: text("analyzer_version").notNull(),
  facts: text("facts").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  analyzedAt: integer("analyzed_at", { mode: "timestamp_ms" }).notNull(),
});

export const aiUsageEvents = sqliteTable("ai_usage_events", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  jobId: text("job_id").references(() => jobs.id),
  operation: text("operation", { enum: ["extract_job", "resolve_ambiguity", "generate_email"] }).notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  status: text("status", { enum: ["completed", "failed", "blocked_budget"] }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

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

export const platformSettings = sqliteTable("platform_settings", {
  id: text("id").primaryKey().default("global"),
  collectionEnabled: integer("collection_enabled", { mode: "boolean" }).notNull().default(true),
  emailImportEnabled: integer("email_import_enabled", { mode: "boolean" }).notNull().default(true),
  enrichmentEnabled: integer("enrichment_enabled", { mode: "boolean" }).notNull().default(true),
  defaultPeriod: text("default_period").notNull().default("24"),
  defaultMinScore: integer("default_min_score").notNull().default(70),
  staleAfterDays: integer("stale_after_days").notNull().default(7),
  retentionDays: integer("retention_days").notNull().default(180),
  updatedBy: text("updated_by"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const alertPreferences = sqliteTable("alert_preferences", {
  userId: text("user_id").primaryKey(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  minScore: integer("min_score").notNull().default(80),
  frequency: text("frequency", { enum: ["instant", "daily"] }).notNull().default("daily"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const alertReads = sqliteTable("alert_reads", {
  userId: text("user_id").notNull(),
  jobId: text("job_id").notNull().references(() => jobs.id),
  readAt: integer("read_at", { mode: "timestamp_ms" }).notNull(),
}, t => [primaryKey({ columns: [t.userId, t.jobId] })]);

export const alertDeliveries = sqliteTable("alert_deliveries", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  channel: text("channel", { enum: ["email"] }).notNull().default("email"),
  periodKey: text("period_key").notNull(),
  status: text("status", { enum: ["prepared", "sent", "failed"] }).notNull().default("prepared"),
  jobCount: integer("job_count").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  sentAt: integer("sent_at", { mode: "timestamp_ms" }),
});

// --- RBAC: perfis (roles), permissões e grupos de acesso ---

export const roles = sqliteTable("roles", {
  id: text("id").primaryKey(), name: text("name").notNull(), description: text("description"),
  isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, table => [uniqueIndex("roles_name_unique").on(table.name)]);

export const permissions = sqliteTable("permissions", {
  id: text("id").primaryKey(), module: text("module").notNull(), description: text("description").notNull(),
});

export const rolePermissions = sqliteTable("role_permissions", {
  roleId: text("role_id").notNull().references(() => roles.id),
  permissionId: text("permission_id").notNull().references(() => permissions.id),
}, table => [primaryKey({ columns: [table.roleId, table.permissionId] })]);

export const groups = sqliteTable("groups", {
  id: text("id").primaryKey(), name: text("name").notNull(), description: text("description"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, table => [uniqueIndex("groups_name_unique").on(table.name)]);

export const groupRoles = sqliteTable("group_roles", {
  groupId: text("group_id").notNull().references(() => groups.id),
  roleId: text("role_id").notNull().references(() => roles.id),
}, table => [primaryKey({ columns: [table.groupId, table.roleId] })]);

export const userRoles = sqliteTable("user_roles", {
  userId: text("user_id").notNull(), roleId: text("role_id").notNull().references(() => roles.id),
}, table => [primaryKey({ columns: [table.userId, table.roleId] })]);

export const userGroups = sqliteTable("user_groups", {
  userId: text("user_id").notNull(), groupId: text("group_id").notNull().references(() => groups.id),
}, table => [primaryKey({ columns: [table.userId, table.groupId] })]);

export const accessAuditLog = sqliteTable("access_audit_log", {
  id: text("id").primaryKey(), actorUserId: text("actor_user_id").notNull(), action: text("action").notNull(),
  targetType: text("target_type").notNull(), targetId: text("target_id").notNull(), metadata: text("metadata"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});
