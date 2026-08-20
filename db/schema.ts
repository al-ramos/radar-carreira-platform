import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
  publishedAt: integer("published_at", { mode: "timestamp_ms" }),
  sourcePublishedAt: integer("source_published_at", { mode: "timestamp_ms" }),
  ingestionMode: text("ingestion_mode", { enum: ["automatic", "manual"] }).notNull().default("manual"),
  ingestionChannel: text("ingestion_channel", { enum: ["extension", "email", "connector", "file", "api"] }).notNull().default("file"),
  roleArea: text("role_area").notNull().default("other"),
  url: text("url").notNull(), applyUrl: text("apply_url"),
  contactEmail: text("contact_email"), contactSubject: text("contact_subject"), description: text("description").notNull().default(""),
  firstSeenAt: integer("first_seen_at", { mode: "timestamp_ms" }).notNull(), lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
  status: text("status", { enum: ["active", "possibly_closed", "closed"] }).notNull().default("active"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, t => [uniqueIndex("jobs_fingerprint_unique").on(t.fingerprint)]);

export const userJobStatus = sqliteTable("user_job_status", {
  userId: text("user_id").notNull(), jobId: text("job_id").notNull().references(() => jobs.id),
  stage: text("stage", { enum: ["viewed", "saved", "applied", "interview", "offer", "rejected", "archived"] }).notNull().default("viewed"),
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
  profileRevision: text("profile_revision").notNull().default("legacy"),
  rulesRevision: text("rules_revision").notNull().default("legacy"),
  instructionsRevision: text("instructions_revision").notNull().default("legacy"),
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

/** Lote imutável de uma execução manual, agendada ou assistida. */
export const triageBatches = sqliteTable("triage_batches", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), trigger: text("trigger", { enum: ["manual", "scheduled", "assistant"] }).notNull(),
  scope: text("scope").notNull(), status: text("status", { enum: ["queued", "running", "completed", "failed", "cancelled"] }).notNull().default("queued"),
  startedAt: integer("started_at", { mode: "timestamp_ms" }), completedAt: integer("completed_at", { mode: "timestamp_ms" }), error: text("error"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, t => [index("triage_batches_user_created_idx").on(t.userId, t.createdAt)]);

/** Histórico aditivo: uma vaga pode ser julgada por vários lotes. */
export const triageHistory = sqliteTable("triage_history", {
  id: text("id").primaryKey(), batchId: text("batch_id").notNull().references(() => triageBatches.id), userId: text("user_id").notNull(), jobId: text("job_id").notNull().references(() => jobs.id),
  profileRevision: text("profile_revision").notNull(), rulesRevision: text("rules_revision").notNull(), instructionsRevision: text("instructions_revision").notNull(),
  verdict: text("verdict", { enum: ["✅", "🟡", "🔴", "❌"] }).notNull(), label: text("label").notNull(), blocker: text("blocker"),
  source: text("source", { enum: ["rules", "ai"] }).notNull(), confidence: integer("confidence").notNull(), rows: text("rows").notNull().default("[]"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, t => [index("triage_history_user_job_created_idx").on(t.userId, t.jobId, t.createdAt), index("triage_history_batch_idx").on(t.batchId)]);

export const triageBatchItems = sqliteTable("triage_batch_items", {
  batchId: text("batch_id").notNull().references(() => triageBatches.id), jobId: text("job_id").notNull().references(() => jobs.id),
  status: text("status", { enum: ["queued", "processing", "completed", "failed", "skipped"] }).notNull().default("queued"),
  historyId: text("history_id").references(() => triageHistory.id), error: text("error"), attemptCount: integer("attempt_count").notNull().default(0),
  leaseOwner: text("lease_owner"), leaseUntil: integer("lease_until", { mode: "timestamp_ms" }), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, t => [primaryKey({ columns: [t.batchId, t.jobId] }), index("triage_batch_items_status_idx").on(t.batchId, t.status)]);

/** Chave global que impede o mesmo perfil/vaga/versões de ser processado duas vezes. */
export const triageDeduplication = sqliteTable("triage_deduplication", {
  idempotencyKey: text("idempotency_key").primaryKey(), userId: text("user_id").notNull(), jobId: text("job_id").notNull().references(() => jobs.id),
  profileRevision: text("profile_revision").notNull(), rulesRevision: text("rules_revision").notNull(), instructionsRevision: text("instructions_revision").notNull(),
  status: text("status", { enum: ["processing", "completed", "failed"] }).notNull(), historyId: text("history_id").references(() => triageHistory.id),
  leaseOwner: text("lease_owner"), leaseUntil: integer("lease_until", { mode: "timestamp_ms" }), attemptCount: integer("attempt_count").notNull().default(0), error: text("error"), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, t => [index("triage_deduplication_lease_idx").on(t.status, t.leaseUntil)]);

/** Outbox persistente; a etapa futura cria/atualiza, mas nunca envia e-mail. */
export const draftOutbox = sqliteTable("draft_outbox", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), jobId: text("job_id").notNull().references(() => jobs.id), historyId: text("history_id").notNull().references(() => triageHistory.id),
  status: text("status", { enum: ["pending", "drafted", "failed", "cancelled"] }).notNull().default("pending"), gmailDraftId: text("gmail_draft_id"), error: text("error"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, t => [uniqueIndex("draft_outbox_user_job_unique").on(t.userId, t.jobId), index("draft_outbox_status_idx").on(t.userId, t.status)]);

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

/**
 * Triagem automática diária de vagas (assistente de candidatura).
 *
 * Marca cada vaga como já processada pela análise automática (critérios de
 * aderência .NET/C# do usuário), independente de qualquer análise de IA por
 * usuário em `user_job_analyses`. Sem `userId` pelo mesmo motivo de
 * `notifications`: hoje só a proprietária opera esse fluxo. `veredito` usa
 * os mesmos símbolos de `userJobAnalyses.verdict` para consistência, mas é
 * uma tabela própria porque a origem, o disparo (scheduled task diária) e o
 * propósito (checar/gate, não julgamento por perfil) são diferentes.
 */
export const jobAiTriage = sqliteTable("job_ai_triage", {
  jobId: text("job_id").primaryKey().references(() => jobs.id),
  processedAt: integer("processed_at", { mode: "timestamp_ms" }).notNull(),
  veredito: text("veredito", { enum: ["✅", "🟡", "🔴", "❌"] }).notNull(),
  motivo: text("motivo"),
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
  sourceId: text("source_id").references(() => jobSources.id),
  channel: text("channel", { enum: ["extension", "email", "connector", "file", "api"] }).notNull().default("api"),
  received: integer("received").notNull().default(0), inserted: integer("inserted").notNull().default(0), updated: integer("updated").notNull().default(0),
  duplicates: integer("duplicates").notNull().default(0), errors: integer("errors").notNull().default(0), actorUserId: text("actor_user_id"),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(), finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
});

export const jobImportRuns = sqliteTable("job_import_runs", {
  runId: text("run_id").notNull().references(() => importRuns.id),
  jobId: text("job_id").notNull().references(() => jobs.id),
  outcome: text("outcome", { enum: ["inserted", "updated", "duplicate"] }).notNull(),
  receivedAt: integer("received_at", { mode: "timestamp_ms" }).notNull(),
}, table => [primaryKey({ columns: [table.runId, table.jobId] })]);

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

/**
 * Histórico único de notificações operacionais (sino no portal).
 *
 * Genérica por desenho: `type` cobre o evento hoje (`import`) e os próximos
 * itens do roadmap (`report`, `digest`, `pipeline`) sem precisar de tabela
 * nova a cada entrega. Sem `userId` porque quem opera fontes/importações
 * hoje é exclusivamente a proprietária da conta; a rota de leitura filtra
 * por `isOwnerEmail()`, o mesmo padrão do bypass em `lib/rbac.ts`. Quando o
 * produto tiver múltiplos operadores, adicionar `userId` nullable (null =
 * broadcast) é uma migration aditiva, não uma reescrita.
 */
export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  type: text("type", { enum: ["import", "report", "digest", "pipeline"] }).notNull(),
  severity: text("severity", { enum: ["success", "error", "info"] }).notNull().default("info"),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  link: text("link"),
  metadata: text("metadata").notNull().default("{}"),
  read: integer("read", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, t => [index("notifications_created_at_idx").on(t.createdAt)]);

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
