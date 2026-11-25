import { afterAll, beforeEach, expect, mock, test } from 'bun:test';

const realAudit = await import('../db/queries/audit');
const realExports = { ...realAudit };

let latest: string | undefined;
let rows: { action: string; detail: Record<string, unknown> }[] = [];
const written: { action: string; detail?: Record<string, unknown> }[] = [];

mock.module('../db/queries/audit', () => ({
  ...realExports,
  latestAuditAction: () => Promise.resolve(latest),
  listAudit: () => Promise.resolve(rows),
  writeAudit: (row: { action: string; detail?: Record<string, unknown> }) => {
    written.push(row);
    return Promise.resolve();
  },
}));

const { pauseAll, resumeAll } = await import('./pause');

afterAll(() => {
  mock.module('../db/queries/audit', () => realExports);
});

function fakeSchedules({ failing = [] }: { failing?: string[] } = {}) {
  const calls: string[] = [];
  const act = (verb: string) => (id: string) => {
    calls.push(`${verb}:${id}`);
    return failing.includes(id)
      ? Promise.reject(new Error('boom'))
      : Promise.resolve();
  };
  return {
    calls,
    service: {
      list: () => Promise.resolve([{ id: 'a' }, { id: 'b' }]),
      pause: act('pause'),
      resume: act('resume'),
    },
  };
}

beforeEach(() => {
  latest = undefined;
  rows = [];
  written.length = 0;
});

test('a second pause changes nothing and writes no row', async () => {
  latest = 'pause';
  const { calls, service } = fakeSchedules();
  const outcome = await pauseAll({
    agentId: 'x',
    byId: 'UOWNER',
    schedules: service,
  });
  expect(outcome).toEqual({ state: 'unchanged' });
  expect(written).toHaveLength(0);
  expect(calls).toHaveLength(0);
});

test('resume when not paused resumes nothing', async () => {
  latest = 'resume';
  rows = [{ action: 'pause', detail: { scheduleIds: ['a'] } }];
  const { calls, service } = fakeSchedules();
  const outcome = await resumeAll({ byId: 'UOWNER', schedules: service });
  expect(outcome).toEqual({ state: 'unchanged' });
  expect(written).toHaveLength(0);
  expect(calls).toHaveLength(0);
});

test('resume restarts exactly the recorded schedules', async () => {
  latest = 'pause';
  rows = [{ action: 'pause', detail: { scheduleIds: ['a'] } }];
  const { calls, service } = fakeSchedules();
  await resumeAll({ byId: 'UOWNER', schedules: service });
  expect(calls).toEqual(['resume:a']);
  expect(written.map((w) => w.action)).toEqual(['resume']);
});

test('a failing schedule is reported and the audit row is still written', async () => {
  const { service } = fakeSchedules({ failing: ['b'] });
  const outcome = await pauseAll({
    agentId: 'x',
    byId: 'UOWNER',
    schedules: service,
  });
  expect(outcome).toEqual({ state: 'changed', count: 1, failed: ['b'] });
  expect(written.map((w) => w.action)).toEqual(['pause']);
  expect(written[0]?.detail).toEqual({ scheduleIds: ['a', 'b'] });
});
