import { afterAll, beforeEach, expect, mock, test } from 'bun:test';
import type { Approval } from '../types';

const realUtils = { ...(await import('../tools/slack/utils')) };
const realAudit = { ...(await import('../db/queries/audit')) };

const sends: unknown[] = [];
const audits: unknown[] = [];
let failSend = false;

mock.module('../tools/slack/utils', () => ({
  ...realUtils,
  sendMessage: (message: unknown) => {
    if (failSend) {
      return Promise.reject(new Error('channel_not_found'));
    }
    sends.push(message);
    return Promise.resolve({ messageId: '1', threadId: undefined });
  },
}));
mock.module('../db/queries/audit', () => ({
  ...realAudit,
  writeAudit: (row: unknown) => {
    audits.push(row);
    return Promise.resolve();
  },
}));

const { applyDecision } = await import('./approvals');

afterAll(() => {
  mock.module('../tools/slack/utils', () => realUtils);
  mock.module('../db/queries/audit', () => realAudit);
});

beforeEach(() => {
  sends.length = 0;
  audits.length = 0;
  failSend = false;
});

function outbound(status: Approval['status']): Approval {
  return {
    id: '0b6f1c8e-3f5a-4d2b-9c1e-7a8b9c0d1e2f',
    kind: 'outbound_message',
    status,
    payload: { target: { type: 'user', id: 'UOTHER' }, text: 'lunch?' },
    requesterId: 'UOWNER',
    replyThread: null,
    cardChannel: null,
    cardTs: null,
    createdAt: new Date(0),
    expiresAt: new Date(0),
    decidedAt: null,
  };
}

test('an approved message is sent exactly as approved and audited without its text', async () => {
  await applyDecision(outbound('approved'));
  expect(sends).toEqual([
    {
      target: { type: 'user', id: 'UOTHER' },
      markdown: 'lunch?',
      ctx: expect.objectContaining({ userId: 'UOWNER' }),
    },
  ]);
  expect(audits).toEqual([
    {
      actor: 'mark',
      action: 'post',
      detail: {
        target: { type: 'user', id: 'UOTHER' },
        approvalId: '0b6f1c8e-3f5a-4d2b-9c1e-7a8b9c0d1e2f',
      },
    },
  ]);
});

test('a declined message is never sent', async () => {
  await applyDecision(outbound('declined'));
  expect(sends).toHaveLength(0);
  expect(audits).toHaveLength(0);
});

test('a failed send is not audited as a post', async () => {
  failSend = true;
  await applyDecision(outbound('approved'));
  expect(audits).toHaveLength(0);
});
