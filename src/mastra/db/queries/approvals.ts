import { and, asc, eq, gt, lte, sql } from 'drizzle-orm';
import { isOwner } from '../../lib/owner';
import {
  type Approval,
  type ApprovalDecision,
  type ApprovalKind,
  approvalPayloadSchemas,
  approvalSchema,
  type ResolveApprovalResult,
} from '../../types';
import { db } from '../client';
import { approvals } from '../schema';
import { writeAudit } from './audit';

export async function createApproval({
  kind,
  payload,
  requesterId,
  replyThread,
  ttlMs,
}: {
  kind: ApprovalKind;
  payload: unknown;
  requesterId?: string;
  replyThread?: string;
  ttlMs: number;
}): Promise<Approval> {
  const [row] = await db
    .insert(approvals)
    .values({
      kind,
      payload: approvalPayloadSchemas[kind].parse(payload),
      requesterId,
      replyThread,
      expiresAt: new Date(Date.now() + ttlMs),
    })
    .returning();
  const approval = approvalSchema.parse(row);
  await writeAudit({
    actor: kind === 'request' ? 'receptionist' : 'mark',
    action: 'approval.created',
    detail: { id: approval.id, kind, requesterId },
  });
  return approval;
}

export async function setApprovalCard({
  id,
  channel,
  ts,
}: {
  id: string;
  channel: string;
  ts: string;
}): Promise<void> {
  await db
    .update(approvals)
    .set({ cardChannel: channel, cardTs: ts })
    .where(eq(approvals.id, id));
}

export async function resolveApproval({
  id,
  decision,
  deciderId,
}: {
  id: string;
  decision: ApprovalDecision;
  deciderId: string;
}): Promise<ResolveApprovalResult> {
  if (!isOwner(deciderId)) {
    await writeAudit({
      actor: 'system',
      action: 'approval.forbidden',
      detail: { id, decision, deciderId },
    });
    return { result: 'forbidden' };
  }
  const outcome = await decide({ id, decision });
  await writeAudit({
    actor: 'owner',
    action: 'approval.resolved',
    detail: { id, decision, result: outcome.result },
  });
  return outcome;
}

// The single conditional UPDATE is what makes two presses safe: Postgres lets
// only one of them match `status = 'pending'`.
async function decide({
  id,
  decision,
}: {
  id: string;
  decision: ApprovalDecision;
}): Promise<ResolveApprovalResult> {
  const [updated] = await db
    .update(approvals)
    .set({ status: decision, decidedAt: sql`now()` })
    .where(
      and(
        eq(approvals.id, id),
        eq(approvals.status, 'pending'),
        gt(approvals.expiresAt, sql`now()`)
      )
    )
    .returning();
  if (updated) {
    return { result: 'ok', approval: approvalSchema.parse(updated) };
  }
  const [existing] = await db
    .select({ status: approvals.status })
    .from(approvals)
    .where(eq(approvals.id, id));
  if (!existing) {
    return { result: 'not_found' };
  }
  if (existing.status === 'expired') {
    return { result: 'expired' };
  }
  if (existing.status !== 'pending') {
    return { result: 'already_resolved' };
  }
  await db
    .update(approvals)
    .set({ status: 'expired' })
    .where(and(eq(approvals.id, id), eq(approvals.status, 'pending')));
  return { result: 'expired' };
}

export async function expireApprovals({
  now,
}: {
  now: Date;
}): Promise<Approval[]> {
  const rows = await db
    .update(approvals)
    .set({ status: 'expired' })
    .where(and(eq(approvals.status, 'pending'), lte(approvals.expiresAt, now)))
    .returning();
  const expired = rows.map((row) => approvalSchema.parse(row));
  if (expired.length > 0) {
    await writeAudit({
      actor: 'system',
      action: 'approval.expired',
      detail: { ids: expired.map((approval) => approval.id) },
    });
  }
  return expired;
}

export async function listApprovedRules(): Promise<string[]> {
  const rows = await db
    .select({ payload: approvals.payload })
    .from(approvals)
    .where(
      and(eq(approvals.kind, 'standing_rule'), eq(approvals.status, 'approved'))
    )
    .orderBy(asc(approvals.decidedAt));
  return rows.map(
    (row) => approvalPayloadSchemas.standing_rule.parse(row.payload).rule
  );
}
