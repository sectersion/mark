import { afterAll, beforeEach, expect, mock, test } from 'bun:test';

const realAudit = { ...(await import('../db/queries/audit')) };
const realInstance = { ...(await import('./instance')) };

const rows: { action: string; at: Date }[] = [];
const written: { actor: string; action: string; detail?: unknown }[] = [];
const dms: string[] = [];

mock.module('../db/queries/audit', () => ({
  ...realAudit,
  countAuditByAction: ({
    actions,
    since,
  }: {
    actions: string[];
    since: Date;
  }) => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      if (actions.includes(row.action) && row.at >= since) {
        counts.set(row.action, (counts.get(row.action) ?? 0) + 1);
      }
    }
    return Promise.resolve(counts);
  },
  writeAudit: (row: { actor: string; action: string; detail?: unknown }) => {
    written.push(row);
    rows.push({ action: row.action, at: new Date() });
    return Promise.resolve();
  },
}));
mock.module('./instance', () => ({
  ...realInstance,
  chat: () => ({
    openDM: () =>
      Promise.resolve({
        post: (text: string) => {
          dms.push(text);
          return Promise.resolve();
        },
      }),
  }),
}));

const { enforceDailyCaps } = await import('./caps');
const { startOfLocalDay } = await import('../lib/caps');

afterAll(() => {
  mock.module('../db/queries/audit', () => realAudit);
  mock.module('./instance', () => realInstance);
});

beforeEach(() => {
  rows.length = 0;
  written.length = 0;
  dms.length = 0;
});

function seed({ action, n, at }: { action: string; n: number; at: Date }) {
  for (let i = 0; i < n; i++) {
    rows.push({ action, at });
  }
}

test('under the caps nothing is written and nobody is capped', async () => {
  seed({ action: 'turn', n: 499, at: new Date() });
  expect(await enforceDailyCaps()).toBe(false);
  expect(written).toEqual([]);
  expect(dms).toEqual([]);
});

test('a breach writes cap.exceeded and DMs the owner once a day', async () => {
  seed({ action: 'receptionist.reply', n: 200, at: new Date() });
  expect(await enforceDailyCaps()).toBe(true);
  expect(await enforceDailyCaps()).toBe(true);
  expect(written).toEqual([
    {
      actor: 'system',
      action: 'cap.exceeded',
      detail: { cap: 'receptionistReplies', count: 200, limit: 200 },
    },
  ]);
  expect(dms).toHaveLength(1);
});

test('a cap.exceeded row from before local midnight no longer counts', async () => {
  const yesterday = new Date(
    startOfLocalDay({ now: new Date() }).getTime() - 1
  );
  seed({ action: 'cap.exceeded', n: 1, at: yesterday });
  seed({ action: 'turn', n: 600, at: yesterday });
  expect(await enforceDailyCaps()).toBe(false);
  expect(written).toEqual([]);
});
