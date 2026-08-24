import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { getDb } from "../../../../../db/index";
import { importRuns, jobImportRuns, jobs, notifications } from "../../../../../db/schema";
import { can } from "../../../../../lib/rbac";

export const dynamic = "force-dynamic";

const parseMetadata = (value: string) => { try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; } };
const parseDetails = (value: string | null) => { try { return value ? JSON.parse(value) as Record<string, unknown> : {}; } catch { return {}; } };

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });
  if (!await can(user, "import.run")) return NextResponse.json({ error: "Acesso restrito a importações" }, { status: 403 });
  const { id } = await context.params;
  const db = getDb();
  const run = (await db.select().from(importRuns).where(eq(importRuns.id, id)).limit(1))[0];
  if (!run) return NextResponse.json({ error: "Importação não encontrada" }, { status: 404 });
  const [affectedJobs, recentNotifications] = await Promise.all([
    db.select({ id: jobs.id, company: jobs.company, title: jobs.title, location: jobs.location, workMode: jobs.workMode, outcome: jobImportRuns.outcome, receivedAt: jobImportRuns.receivedAt })
      .from(jobImportRuns).innerJoin(jobs, eq(jobImportRuns.jobId, jobs.id)).where(eq(jobImportRuns.runId, id)).orderBy(desc(jobImportRuns.receivedAt)).limit(500),
    db.select({ body: notifications.body, metadata: notifications.metadata }).from(notifications).where(eq(notifications.type, "import")).orderBy(desc(notifications.createdAt)).limit(50),
  ]);
  const notification = recentNotifications.find(item => parseMetadata(item.metadata).runId === id);
  const notificationError = notification ? parseMetadata(notification.metadata).error : null;
  const metadata = notification ? parseMetadata(notification.metadata) : {};
  const details = parseDetails(run.details);
  const intakeSource = Object.keys(details).length ? details : metadata;
  const intake = typeof intakeSource.valid === "number" || typeof intakeSource.invalid === "number"
    ? { valid: typeof intakeSource.valid === "number" ? intakeSource.valid : null, invalid: typeof intakeSource.invalid === "number" ? intakeSource.invalid : 0, invalidReasons: typeof intakeSource.invalidReasons === "object" && intakeSource.invalidReasons ? intakeSource.invalidReasons : {}, rejectedProfile: typeof intakeSource.rejectedProfile === "number" ? intakeSource.rejectedProfile : 0, accepted: typeof intakeSource.accepted === "number" ? intakeSource.accepted : null, profileRule: typeof intakeSource.profileRule === "string" ? intakeSource.profileRule : null }
    : null;
  return NextResponse.json({ run, jobs: affectedJobs, intake, error: typeof notificationError === "string" ? notificationError : (run.status === "failed" ? notification?.body ?? "Falha sem detalhe disponível para esta execução antiga." : null) });
}
