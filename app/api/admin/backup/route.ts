import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { accessAuditLog, aiUsageEvents, alertDeliveries, alertPreferences, alertReads, groupRoles, groups, importRuns, jobAiFacts, jobEvents, jobs, jobSources, localAccounts, permissions, platformSettings, profiles, rolePermissions, roles, userGroups, userJobAnalyses, userJobStatus, userRoles } from "../../../../db/schema";
import { can } from "../../../../lib/rbac";

export const dynamic = "force-dynamic";

async function admin() {
  const user = await getChatGPTUser();
  return user && await can(user, "backup.export") ? user : null;
}

export async function GET() {
  if (!await admin()) return NextResponse.json({ error: "Acesso de administrador necessário" }, { status: 403 });
  const db = getDb();
  const [jobRows, sources, runs, events, settings, profileRows, accounts, pipeline, analyses, aiFacts, aiEvents, preferences, deliveries, reads, roleRows, permissionCatalog, permissionRows, groupRows, groupRoleRows, userGroupRows, userRoleRows, audit] = await Promise.all([
    db.select().from(jobs).orderBy(desc(jobs.updatedAt)), db.select().from(jobSources), db.select().from(importRuns).orderBy(desc(importRuns.startedAt)), db.select().from(jobEvents).orderBy(desc(jobEvents.occurredAt)), db.select().from(platformSettings).limit(1), db.select().from(profiles),
    db.select({ userId: localAccounts.userId, email: localAccounts.email, name: localAccounts.name, createdAt: localAccounts.createdAt, updatedAt: localAccounts.updatedAt }).from(localAccounts), db.select().from(userJobStatus), db.select().from(userJobAnalyses), db.select().from(jobAiFacts), db.select().from(aiUsageEvents), db.select().from(alertPreferences), db.select().from(alertDeliveries), db.select().from(alertReads), db.select().from(roles), db.select().from(permissions), db.select().from(rolePermissions), db.select().from(groups), db.select().from(groupRoles), db.select().from(userGroups), db.select().from(userRoles), db.select().from(accessAuditLog),
  ]);
  const safeSources = sources.map(source => ({ id: source.id, name: source.name, provider: source.provider, externalRef: source.id === "gmail-radarvagas" ? "[protegido]" : source.externalRef, enabled: source.enabled, lastRunAt: source.lastRunAt, createdAt: source.createdAt }));
  const data = { jobs: jobRows, sources: safeSources, importRuns: runs, jobEvents: events, platformSettings: settings[0] ? { ...settings[0], updatedBy: null } : null, profiles: profileRows, localAccounts: accounts, pipeline, userJobAnalyses: analyses, jobAiFacts: aiFacts, aiUsageEvents: aiEvents, alertPreferences: preferences, alertDeliveries: deliveries, alertReads: reads, roles: roleRows, permissions: permissionCatalog, rolePermissions: permissionRows, groups: groupRows, groupRoles: groupRoleRows, userGroups: userGroupRows, userRoles: userRoleRows, accessAuditLog: audit };
  const backup = { format: "radar-carreira-backup", version: 2, exportedAt: new Date().toISOString(), counts: { jobs: jobRows.length, sources: safeSources.length, runs: runs.length, events: events.length, profiles: profileRows.length, pipeline: pipeline.length, analyses: analyses.length }, data };
  return new NextResponse(JSON.stringify(backup, null, 2), { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="radar-carreira-backup-${new Date().toISOString().slice(0, 10)}.json"`, "cache-control": "no-store" } });
}
