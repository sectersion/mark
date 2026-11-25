import { dailyCaps } from '../config';
import type { CapDecision, CapName } from '../types';

function zoneOffsetMs({
  at,
  timeZone,
}: {
  at: number;
  timeZone: string;
}): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
      .formatToParts(at)
      .map((part) => [part.type, Number(part.value)])
  );
  const local = Date.UTC(
    parts.year ?? 0,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    parts.hour,
    parts.minute,
    parts.second
  );
  return local - Math.floor(at / 1000) * 1000;
}

export function startOfLocalDay({
  now,
  timeZone = dailyCaps.timeZone,
}: {
  now: Date;
  timeZone?: string;
}): Date {
  const local = new Date(
    now.getTime() + zoneOffsetMs({ at: now.getTime(), timeZone })
  );
  const midnightAsUtc = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate()
  );
  // Midnight's own offset can differ from now's on a DST-change day.
  const first = midnightAsUtc - zoneOffsetMs({ at: midnightAsUtc, timeZone });
  return new Date(midnightAsUtc - zoneOffsetMs({ at: first, timeZone }));
}

export function capDecision({
  counts,
  caps = dailyCaps,
}: {
  counts: { ownerTurns: number; receptionistReplies: number };
  caps?: { ownerTurns: number; receptionistReplies: number };
}): CapDecision {
  const names: CapName[] = ['ownerTurns', 'receptionistReplies'];
  for (const cap of names) {
    if (counts[cap] >= caps[cap]) {
      return { status: 'exceeded', cap, count: counts[cap], limit: caps[cap] };
    }
  }
  return { status: 'ok' };
}
