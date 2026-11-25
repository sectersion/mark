import { z } from 'zod';
import { stripInvisible } from '../lib/invisible';
import { targetSchema } from './target';

// Stripped before it is stored, so the stored text is exactly what the
// approval card shows. Text that was only invisible characters is rejected.
function visibleText(max: number) {
  return z
    .string()
    .min(1)
    .max(max)
    .transform(stripInvisible)
    .pipe(z.string().min(1));
}

export const approvalPayloadSchemas = {
  request: z.object({
    summary: visibleText(500),
    wantsReply: z.boolean(),
  }),
  standing_rule: z.object({ rule: visibleText(300) }),
  outbound_message: z.object({
    target: targetSchema,
    text: visibleText(2800),
  }),
};

export type ApprovalKind = keyof typeof approvalPayloadSchemas;

export interface StandingRule {
  id: string;
  rule: string;
}

export const approvalStatusSchema = z.enum([
  'pending',
  'approved',
  'declined',
  'expired',
]);

export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

export type ApprovalDecision = Extract<ApprovalStatus, 'approved' | 'declined'>;

const approvalColumns = {
  id: z.string(),
  status: approvalStatusSchema,
  requesterId: z.string().nullable(),
  replyThread: z.string().nullable(),
  cardChannel: z.string().nullable(),
  cardTs: z.string().nullable(),
  createdAt: z.date(),
  expiresAt: z.date(),
  decidedAt: z.date().nullable(),
};

export const approvalSchema = z.discriminatedUnion('kind', [
  z.object({
    ...approvalColumns,
    kind: z.literal('request'),
    payload: approvalPayloadSchemas.request,
  }),
  z.object({
    ...approvalColumns,
    kind: z.literal('standing_rule'),
    payload: approvalPayloadSchemas.standing_rule,
  }),
  z.object({
    ...approvalColumns,
    kind: z.literal('outbound_message'),
    payload: approvalPayloadSchemas.outbound_message,
  }),
]);

export type Approval = z.infer<typeof approvalSchema>;

export type ResolveApprovalResult =
  | { result: 'ok'; approval: Approval }
  // `approval` is set only when this call is the one that marked it expired,
  // so the requester is told exactly once (the sweep covers the rest).
  | { result: 'expired'; approval?: Approval }
  | { result: 'forbidden' | 'already_resolved' | 'not_found' };

export const auditActorSchema = z.enum([
  'mark',
  'receptionist',
  'owner',
  'system',
]);

export type AuditActor = z.infer<typeof auditActorSchema>;

export const auditRowSchema = z.object({
  id: z.number(),
  at: z.date(),
  actor: auditActorSchema,
  action: z.string(),
  detail: z.record(z.string(), z.unknown()),
});

export type AuditRow = z.infer<typeof auditRowSchema>;
