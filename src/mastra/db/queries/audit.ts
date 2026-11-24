import { desc, gte, inArray } from 'drizzle-orm';
import { type AuditActor, type AuditRow, auditRowSchema } from '../../types';
import { db } from '../client';
import { auditLog } from '../schema';

export async function writeAudit({
  actor,
  action,
  detail,
}: {
  actor: AuditActor;
  action: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(auditLog).values({ actor, action, detail });
}

export async function listAudit({
  since,
}: {
  since: Date;
}): Promise<AuditRow[]> {
  const rows = await db
    .select()
    .from(auditLog)
    .where(gte(auditLog.at, since))
    .orderBy(desc(auditLog.id));
  return rows.map((row) => auditRowSchema.parse(row));
}

export async function latestAuditAction({
  actions,
}: {
  actions: string[];
}): Promise<string | undefined> {
  const [row] = await db
    .select({ action: auditLog.action })
    .from(auditLog)
    .where(inArray(auditLog.action, actions))
    .orderBy(desc(auditLog.id))
    .limit(1);
  return row?.action;
}
