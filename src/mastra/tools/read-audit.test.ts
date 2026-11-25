import { expect, test } from 'bun:test';
import { receptionist } from '../agents/receptionist';
import type { AuditRow } from '../types';
import { readAuditInputSchema, shapeAudit } from './read-audit';
import { orchestratorTools } from './toolsets';

const accepts = async (value: unknown) => {
  const result = await readAuditInputSchema['~standard'].validate(value);
  return !result.issues;
};

const row = (id: number, at: string): AuditRow => ({
  id,
  at: new Date(at),
  actor: 'mark',
  action: 'post',
  detail: { target: { type: 'user', id: 'UOTHER' } },
});

test('sinceHours accepts 1 and 168', async () => {
  expect(await accepts({ sinceHours: 1 })).toBe(true);
  expect(await accepts({ sinceHours: 168 })).toBe(true);
});

test('sinceHours rejects out of range, non-integer, string, and extra keys', async () => {
  expect(await accepts({ sinceHours: 0 })).toBe(false);
  expect(await accepts({ sinceHours: 169 })).toBe(false);
  expect(await accepts({ sinceHours: 1.5 })).toBe(false);
  expect(await accepts({ sinceHours: '24' })).toBe(false);
  expect(await accepts({ sinceHours: 24, actor: 'owner' })).toBe(false);
  expect(await accepts({})).toBe(false);
});

test('shapeAudit returns rows newest first and only within the window', () => {
  const shaped = shapeAudit({
    rows: [
      row(1, '2026-01-01T10:00:00Z'),
      row(3, '2026-01-01T12:00:00Z'),
      row(2, '2026-01-01T11:00:00Z'),
      row(0, '2025-12-31T00:00:00Z'),
    ],
    since: new Date('2026-01-01T00:00:00Z'),
  });
  expect(shaped.rows.map((r) => r.at)).toEqual([
    '2026-01-01T12:00:00.000Z',
    '2026-01-01T11:00:00.000Z',
    '2026-01-01T10:00:00.000Z',
  ]);
  expect(shaped.truncated).toBe(false);
});

test('shapeAudit keeps the newest rows and flags truncation', () => {
  const shaped = shapeAudit({
    rows: [
      row(1, '2026-01-01T10:00:00Z'),
      row(2, '2026-01-01T11:00:00Z'),
      row(3, '2026-01-01T12:00:00Z'),
    ],
    since: new Date('2026-01-01T00:00:00Z'),
    limit: 2,
  });
  expect(shaped.rows.map((r) => r.at)).toEqual([
    '2026-01-01T12:00:00.000Z',
    '2026-01-01T11:00:00.000Z',
  ]);
  expect(shaped.truncated).toBe(true);
});

test('read_audit is in mark toolset and not the receptionist', async () => {
  expect(Object.keys(await orchestratorTools())).toContain('read_audit');
  expect(Object.keys((await receptionist.listTools()) ?? {})).not.toContain(
    'read_audit'
  );
});

test.skipIf(!process.env.TEST_DB)(
  'rows written through writeAudit come back through listAudit and shapeAudit',
  async () => {
    const { listAudit, writeAudit } = await import('../db/queries/audit');
    const since = new Date(Date.now() - 3_600_000);
    await writeAudit({ actor: 'mark', action: 'post', detail: { n: 1 } });
    const shaped = shapeAudit({ rows: await listAudit({ since }), since });
    expect(shaped.rows[0]?.detail).toEqual({ n: 1 });
  }
);
