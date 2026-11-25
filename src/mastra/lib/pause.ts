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

interface ScheduleService {
  list: (filter: {
    agentId: string;
    status: 'active';
  }) => Promise<{ id: string }[]>;
  pause: (id: string) => Promise<unknown>;
  resume: (id: string) => Promise<unknown>;
}

async function settle({
  ids,
  run,
}: {
  ids: string[];
  run: (id: string) => Promise<unknown>;
}): Promise<string[]> {
  const results = await Promise.allSettled(ids.map(run));
  return ids.filter((_, i) => results[i]?.status === 'rejected');
}

export type PauseOutcome =
  | { state: 'unchanged' }
  | { state: 'changed'; count: number; failed: string[] };

export async function pauseAll({
  agentId,
  byId,
  schedules,
}: {
  agentId: string;
  byId: string;
  schedules: ScheduleService;
}): Promise<PauseOutcome> {
  if (await isPaused()) {
    return { state: 'unchanged' };
  }
  const active = await schedules.list({ agentId, status: 'active' });
  const scheduleIds = active.map((schedule) => schedule.id);
  await setPaused({ paused: true, byId, scheduleIds });
  const failed = await settle({
    ids: scheduleIds,
    run: (id) => schedules.pause(id),
  });
  return {
    state: 'changed',
    count: scheduleIds.length - failed.length,
    failed,
  };
}

export async function resumeAll({
  byId,
  schedules,
}: {
  byId: string;
  schedules: ScheduleService;
}): Promise<PauseOutcome> {
  if (!(await isPaused())) {
    return { state: 'unchanged' };
  }
  const scheduleIds = await latestPausedScheduleIds();
  await setPaused({ paused: false, byId });
  const failed = await settle({
    ids: scheduleIds,
    run: (id) => schedules.resume(id),
  });
  return {
    state: 'changed',
    count: scheduleIds.length - failed.length,
    failed,
  };
}
