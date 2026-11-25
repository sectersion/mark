import { afterAll, beforeEach, expect, mock, test } from 'bun:test';
import type { Approval } from '../types';

const realUtils = { ...(await import('../tools/slack/utils')) };
const realAudit = { ...(await import('../db/queries/audit')) };
const realQueries = { ...(await import('../db/queries/approvals')) };
const realInstance = { ...(await import('./instance')) };

const sends: unknown[] = [];
const audits: unknown[] = [];
const ownerDms: unknown[] = [];
let failSend = false;

mock.module('../tools/slack/utils', () => ({
  ...realUtils,
  sendMessage: (message: unknown) => {
    if (failSend) {
      return Promise.reject(
        Object.assign(new Error('An API error occurred: channel_not_found'), {
          data: { error: 'channel_not_found' },
        })
      );
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

mock.module('../db/queries/approvals', () => ({
  ...realQueries,
  setApprovalCard: () => Promise.resolve(),
}));
mock.module('./instance', () => ({
  ...realInstance,
  chat: () => ({
    openDM: () =>
      Promise.resolve({
        post: (message: unknown) => {
          ownerDms.push(message);
          return Promise.resolve({ id: '1', threadId: 'slack:D222:' });
        },
      }),
  }),
}));

const { applyDecision, postApprovalCard } = await import('./approvals');

afterAll(() => {
  mock.module('../tools/slack/utils', () => realUtils);
  mock.module('../db/queries/audit', () => realAudit);
  mock.module('../db/queries/approvals', () => realQueries);
  mock.module('./instance', () => realInstance);
});

beforeEach(() => {
  sends.length = 0;
  audits.length = 0;
  ownerDms.length = 0;
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

test('a failed send is not audited as a post and the owner is told why', async () => {
  failSend = true;
  await applyDecision(outbound('approved'));
  expect(audits).toHaveLength(0);
  expect(ownerDms).toEqual([
    "couldn't send that approved message to <@UOTHER>: channel_not_found",
  ]);
});

test('the card names the target as a live mention, then the escaped text', async () => {
  await postApprovalCard({
    approval: outbound('pending'),
    text: 'lunch? <!channel>',
  });
  const card = JSON.stringify(ownerDms);
  expect(card).toContain('to <@UOTHER>');
  expect(card).toContain('lunch? &lt;!channel&gt;');
  expect(card).not.toContain('from <@UOWNER>');
});
