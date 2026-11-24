import { z } from 'zod';
import { latestAuditAction, listAudit, writeAudit } from '../db/queries/audit';
import { isOwner } from './owner';

const scheduleIdsSchema = z.array(z.string()).catch([]);

export async function isPaused(): Promise<boolean> {
  return (
    (await latestAuditAction({ actions: ['pause', 'resume'] })) === 'pause'
  );
}

export async function setPaused({
  paused,
  byId,
  scheduleIds,
}: {
  paused: boolean;
  byId: string;
  scheduleIds?: string[];
}): Promise<void> {
  if (!isOwner(byId)) {
    throw new Error('Only the owner can pause or resume mark.');
  }
  await writeAudit({
    actor: 'owner',
    action: paused ? 'pause' : 'resume',
    detail: scheduleIds ? { scheduleIds } : undefined,
  });
}

export async function latestPausedScheduleIds(): Promise<string[]> {
  const rows = await listAudit({ since: new Date(0) });
  const row = rows.find((r) => r.action === 'pause');
  return scheduleIdsSchema.parse(row?.detail.scheduleIds);
}
