import { receptionist } from '../config';

// ponytail: in-memory, single process; move to Postgres if mark runs on more than one host
const sent = new Map<string, number[]>();

export function allowReceptionist({
  userId,
  now,
}: {
  userId: string;
  now: number;
}): boolean {
  const since = now - receptionist.windowMs;
  for (const [id, times] of sent) {
    if ((times.at(-1) ?? 0) <= since) {
      sent.delete(id);
    }
  }
  const recent = (sent.get(userId) ?? []).filter((time) => time > since);
  if (recent.length >= receptionist.maxMessages) {
    sent.set(userId, recent);
    return false;
  }
  sent.set(userId, [...recent, now]);
  return true;
}

export function trackedReceptionistUsers(): number {
  return sent.size;
}
