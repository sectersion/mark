import { beforeAll, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { ZodError } from 'zod';
import { db, runMigrations } from '..';
import { approvals } from '../schema';
import {
  createApproval,
  expireApprovals,
  listApprovedRules,
  resolveApproval,
} from './approvals';
import { latestAuditAction, listAudit, writeAudit } from './audit';

// The skipped tests need a real Postgres at DATABASE_URL: `TEST_DB=1 bun test src/mastra/db`.
// The payload rejection runs without one because createApproval parses before
// it queries.
const noDb = !process.env.TEST_DB;
const hour = 60 * 60 * 1000;

beforeAll(async () => {
  if (!noDb) {
    await runMigrations();
  }
});

function pendingRequest(ttlMs = hour) {
  return createApproval({
    kind: 'request',
    payload: { summary: 'can we move the call', wantsReply: true },
    requesterId: 'UOTHER',
    replyThread: 'slack:C1:1.1',
    ttlMs,
  });
}

async function statusOf(id: string) {
  const [row] = await db
    .select({ status: approvals.status })
    .from(approvals)
    .where(eq(approvals.id, id));
  return row?.status;
}

test('createApproval rejects a payload that does not match its kind', async () => {
  await expect(
    createApproval({
      kind: 'standing_rule',
      payload: { summary: 'not a rule', wantsReply: false },
      ttlMs: hour,
    })
  ).rejects.toBeInstanceOf(ZodError);
});

test.skipIf(noDb)(
  'a non-owner cannot resolve an approval and the row is unchanged',
  async () => {
    const approval = await pendingRequest();
    const result = await resolveApproval({
      id: approval.id,
      decision: 'approved',
      deciderId: 'UOTHER',
    });
    expect(result).toEqual({ result: 'forbidden' });
    expect(await statusOf(approval.id)).toBe('pending');
  }
);

test.skipIf(noDb)('resolving twice returns already_resolved', async () => {
  const approval = await pendingRequest();
  const first = await resolveApproval({
    id: approval.id,
    decision: 'approved',
    deciderId: 'UOWNER',
  });
  expect(first.result).toBe('ok');
  const second = await resolveApproval({
    id: approval.id,
    decision: 'declined',
    deciderId: 'UOWNER',
  });
  expect(second).toEqual({ result: 'already_resolved' });
  expect(await statusOf(approval.id)).toBe('approved');
});

test.skipIf(noDb)('two simultaneous presses cannot both win', async () => {
  const approval = await pendingRequest();
  const results = await Promise.all(
    (['approved', 'declined'] as const).map((decision) =>
      resolveApproval({ id: approval.id, decision, deciderId: 'UOWNER' })
    )
  );
  expect(results.filter((r) => r.result === 'ok')).toHaveLength(1);
  expect(results.filter((r) => r.result === 'already_resolved')).toHaveLength(
    1
  );
});

test.skipIf(noDb)(
  'resolving after expires_at returns expired and marks the row expired',
  async () => {
    const approval = await pendingRequest(-1000);
    const result = await resolveApproval({
      id: approval.id,
      decision: 'approved',
      deciderId: 'UOWNER',
    });
    expect(result.result).toBe('expired');
    expect(result.result === 'expired' && result.approval).toMatchObject({
      id: approval.id,
      status: 'expired',
    });
    expect(await statusOf(approval.id)).toBe('expired');
    const again = await resolveApproval({
      id: approval.id,
      decision: 'approved',
      deciderId: 'UOWNER',
    });
    expect(again).toEqual({ result: 'expired' });
  }
);

test.skipIf(noDb)('resolving an unknown id returns not_found', async () => {
  const result = await resolveApproval({
    id: crypto.randomUUID(),
    decision: 'approved',
    deciderId: 'UOWNER',
  });
  expect(result).toEqual({ result: 'not_found' });
});

test.skipIf(noDb)(
  'resolveApproval writes an audit row with actor owner',
  async () => {
    const since = new Date(Date.now() - 1000);
    const approval = await pendingRequest();
    await resolveApproval({
      id: approval.id,
      decision: 'declined',
      deciderId: 'UOWNER',
    });
    const rows = await listAudit({ since });
    const resolved = rows.find(
      (row) =>
        row.action === 'approval.resolved' && row.detail.id === approval.id
    );
    expect(resolved?.actor).toBe('owner');
    expect(
      rows.some(
        (row) =>
          row.action === 'approval.created' && row.detail.id === approval.id
      )
    ).toBe(true);
  }
);

test.skipIf(noDb)('a forbidden press is audited', async () => {
  const since = new Date(Date.now() - 1000);
  const approval = await pendingRequest();
  await resolveApproval({
    id: approval.id,
    decision: 'approved',
    deciderId: 'UOTHER',
  });
  const rows = await listAudit({ since });
  expect(
    rows.some(
      (row) =>
        row.action === 'approval.forbidden' && row.detail.id === approval.id
    )
  ).toBe(true);
});

test.skipIf(noDb)(
  'expireApprovals expires only past-due pending rows',
  async () => {
    const stale = await pendingRequest(-1000);
    const fresh = await pendingRequest();
    const expired = await expireApprovals({ now: new Date() });
    expect(expired.map((row) => row.id)).toContain(stale.id);
    expect(expired.map((row) => row.id)).not.toContain(fresh.id);
    expect(await statusOf(stale.id)).toBe('expired');
    expect(await statusOf(fresh.id)).toBe('pending');
  }
);

test.skipIf(noDb)('listApprovedRules lists only approved rules', async () => {
  const rule = (text: string) =>
    createApproval({
      kind: 'standing_rule',
      payload: { rule: text },
      ttlMs: hour,
    });
  const tag = crypto.randomUUID();
  const approved = await rule(`approved ${tag}`);
  const declined = await rule(`declined ${tag}`);
  await rule(`pending ${tag}`);
  const expired = await createApproval({
    kind: 'standing_rule',
    payload: { rule: `expired ${tag}` },
    ttlMs: -1000,
  });
  await resolveApproval({
    id: expired.id,
    decision: 'approved',
    deciderId: 'UOWNER',
  });
  await resolveApproval({
    id: approved.id,
    decision: 'approved',
    deciderId: 'UOWNER',
  });
  await resolveApproval({
    id: declined.id,
    decision: 'declined',
    deciderId: 'UOWNER',
  });
  const rules = (await listApprovedRules()).filter((r) => r.includes(tag));
  expect(rules).toEqual([`approved ${tag}`]);
});

test.skipIf(noDb)(
  'latestAuditAction returns the newest matching action',
  async () => {
    await writeAudit({ actor: 'owner', action: 'pause' });
    await writeAudit({ actor: 'owner', action: 'resume' });
    await writeAudit({ actor: 'mark', action: 'post' });
    expect(await latestAuditAction({ actions: ['pause', 'resume'] })).toBe(
      'resume'
    );
  }
);
