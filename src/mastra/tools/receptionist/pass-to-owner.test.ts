import { afterAll, beforeEach, expect, mock, test } from 'bun:test';
import { RequestContext } from '@mastra/core/request-context';
import { noopObserve } from '@mastra/core/tools';
import type { Approval } from '../../types';

const realApprovals = { ...(await import('../../db/queries/approvals')) };
const realCards = { ...(await import('../../chat/approvals')) };

const created: unknown[] = [];
const cards: unknown[] = [];

const approval: Approval = {
  id: '0b6f1c8e-3f5a-4d2b-9c1e-7a8b9c0d1e2f',
  kind: 'request',
  status: 'pending',
  payload: { summary: 'can we move the call', wantsReply: true },
  requesterId: 'UOTHER',
  replyThread: 'slack:D1:',
  cardChannel: null,
  cardTs: null,
  createdAt: new Date(0),
  expiresAt: new Date(0),
  decidedAt: null,
};

mock.module('../../db/queries/approvals', () => ({
  ...realApprovals,
  createApproval: (row: unknown) => {
    created.push(row);
    return Promise.resolve(approval);
  },
}));
mock.module('../../chat/approvals', () => ({
  ...realCards,
  postApprovalCard: (card: unknown) => {
    cards.push(card);
    return Promise.resolve();
  },
}));

const { passToOwnerTool, passToOwnerTurnKey } = await import('./pass-to-owner');

afterAll(() => {
  mock.module('../../db/queries/approvals', () => realApprovals);
  mock.module('../../chat/approvals', () => realCards);
});

beforeEach(() => {
  created.length = 0;
  cards.length = 0;
});

function freshTurn() {
  const requestContext = new RequestContext();
  requestContext.set('channel', { userId: 'UOTHER', threadId: 'slack:D1:' });
  requestContext.set(passToOwnerTurnKey, { passed: false });
  return requestContext;
}

function pass(requestContext: RequestContext) {
  return passToOwnerTool.execute?.(
    { summary: 'can we move the call', wantsReply: true },
    { requestContext, observe: noopObserve }
  );
}

test('parallel calls in one turn create one approval and one card', async () => {
  const requestContext = freshTurn();
  const results = await Promise.all([
    pass(requestContext),
    pass(requestContext),
    pass(requestContext),
  ]);
  expect(created).toHaveLength(1);
  expect(cards).toHaveLength(1);
  expect(results).toEqual([
    { result: 'passed along' },
    { result: 'passed along' },
    { result: 'passed along' },
  ]);
});

test('requester and reply thread come from request context', async () => {
  await pass(freshTurn());
  expect(created).toEqual([
    {
      kind: 'request',
      payload: { summary: 'can we move the call', wantsReply: true },
      requesterId: 'UOTHER',
      replyThread: 'slack:D1:',
      ttlMs: 24 * 60 * 60 * 1000,
    },
  ]);
});

test('a second turn with a fresh context passes again', async () => {
  await pass(freshTurn());
  await pass(freshTurn());
  expect(created).toHaveLength(2);
  expect(cards).toHaveLength(2);
});
