import { afterAll, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { RequestContext } from '@mastra/core/request-context';
import { noopObserve } from '@mastra/core/tools';
import { slack } from '../../chat/client';
import { type Approval, approvalSchema, targetSchema } from '../../types';

const realApprovals = { ...(await import('../../db/queries/approvals')) };
const realCards = { ...(await import('../../chat/approvals')) };
const realUtils = { ...(await import('./utils')) };

const created: unknown[] = [];
const cards: unknown[] = [];

const approval: Approval = {
  id: '0b6f1c8e-3f5a-4d2b-9c1e-7a8b9c0d1e2f',
  kind: 'outbound_message',
  status: 'pending',
  payload: { target: { type: 'channel', id: 'slack:C555' }, text: 'hi' },
  requesterId: 'UOWNER',
  replyThread: null,
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
mock.module('./utils', () => ({
  ...realUtils,
  ownerDmChannelId: () => Promise.resolve('D222'),
}));

const { canPostDirect, joinChannel, renderTarget, slackReadOnlyKey } =
  await import('./utils');
const { postMessageTool } = await import('./post-message');

afterAll(() => {
  mock.module('../../db/queries/approvals', () => realApprovals);
  mock.module('../../chat/approvals', () => realCards);
  mock.module('./utils', () => realUtils);
});

beforeEach(() => {
  created.length = 0;
  cards.length = 0;
});

const current = 'slack:C111:1700000000.000100';

test('the current thread is direct', () => {
  expect(
    canPostDirect({
      targetThreadId: current,
      targetChannelId: 'slack:C111',
      currentThreadId: current,
      ownerDmChannelId: 'D222',
    })
  ).toBe(true);
});

test("the owner's own DM is direct, by channel or by thread", () => {
  expect(
    canPostDirect({
      targetThreadId: undefined,
      targetChannelId: 'slack:D222',
      currentThreadId: current,
      ownerDmChannelId: 'D222',
    })
  ).toBe(true);
  expect(
    canPostDirect({
      targetThreadId: 'slack:D222:1700000000.000200',
      targetChannelId: 'D222',
      currentThreadId: undefined,
      ownerDmChannelId: 'D222',
    })
  ).toBe(true);
});

test('another thread, even in the same channel, is not direct', () => {
  expect(
    canPostDirect({
      targetThreadId: 'slack:C111:1700000000.000999',
      targetChannelId: 'slack:C111',
      currentThreadId: current,
      ownerDmChannelId: 'D222',
    })
  ).toBe(false);
});

test('a new channel post is not direct, even in the current channel', () => {
  expect(
    canPostDirect({
      targetThreadId: undefined,
      targetChannelId: 'slack:C111',
      currentThreadId: current,
      ownerDmChannelId: 'D222',
    })
  ).toBe(false);
});

test("another user's DM is not direct", () => {
  expect(
    canPostDirect({
      targetThreadId: undefined,
      targetChannelId: 'slack:D333',
      currentThreadId: current,
      ownerDmChannelId: 'D222',
    })
  ).toBe(false);
});

test('anything undefined fails closed', () => {
  expect(
    canPostDirect({
      targetThreadId: undefined,
      targetChannelId: undefined,
      currentThreadId: undefined,
      ownerDmChannelId: undefined,
    })
  ).toBe(false);
  expect(
    canPostDirect({
      targetThreadId: undefined,
      targetChannelId: 'slack:D222',
      currentThreadId: current,
      ownerDmChannelId: undefined,
    })
  ).toBe(false);
  expect(
    canPostDirect({
      targetThreadId: current,
      targetChannelId: 'slack:C111',
      currentThreadId: undefined,
      ownerDmChannelId: 'D222',
    })
  ).toBe(false);
});

function ownerTurn() {
  const requestContext = new RequestContext();
  requestContext.set('channel', {
    userId: 'UOWNER',
    channelId: 'slack:C111',
    threadId: current,
  });
  return requestContext;
}

test('a post anywhere else waits on an approval card and sends nothing', async () => {
  const sent = spyOn(slack.webClient.chat, 'postMessage');
  const result = await postMessageTool.execute?.(
    { target: { type: 'user', id: 'UOTHER' }, message: 'lunch?' },
    { requestContext: ownerTurn(), observe: noopObserve }
  );
  expect(result).toEqual({ result: "waiting on the owner's approval" });
  expect(created).toEqual([
    {
      kind: 'outbound_message',
      payload: { target: { type: 'user', id: 'UOTHER' }, text: 'lunch?' },
      requesterId: 'UOWNER',
      ttlMs: 24 * 60 * 60 * 1000,
    },
  ]);
  expect(cards).toHaveLength(1);
  expect(sent).not.toHaveBeenCalled();
  sent.mockRestore();
});

test('a read-only request context never joins a channel', async () => {
  const join = spyOn(slack.webClient.conversations, 'join');
  const requestContext = new RequestContext();
  requestContext.set(slackReadOnlyKey, true);
  await joinChannel({ channelId: 'slack:C444', requestContext });
  expect(join).not.toHaveBeenCalled();
  join.mockRestore();
});

const hostileIds = [
  'slack:C111>|<!channel>',
  'UOTHER> <!channel',
  'UOTHER\n<!channel>',
  '<!channel>',
  'C111|evil',
  `U${'A'.repeat(80)}`,
];

test('a hostile target id is rejected by the schema', () => {
  for (const id of hostileIds) {
    for (const type of ['user', 'channel', 'thread']) {
      expect(targetSchema.safeParse({ type, id }).success).toBe(false);
    }
    expect(
      approvalSchema.safeParse({
        ...approval,
        payload: { target: { type: 'user', id }, text: 'hi' },
      }).success
    ).toBe(false);
  }
});

test('existing target spellings still parse', () => {
  for (const target of [
    { type: 'user', id: 'UOTHER' },
    { type: 'user', id: 'W0123ABC' },
    { type: 'channel', id: 'slack:C111' },
    { type: 'channel', id: 'G0123' },
    { type: 'channel', id: 'slack:D222' },
    { type: 'thread', id: current },
    { type: 'thread', id: 'slack:D222:' },
  ]) {
    expect(targetSchema.safeParse(target).success).toBe(true);
  }
});

test('a hostile target id never reaches an approval card', async () => {
  const results = await Promise.all(
    hostileIds.map((id) =>
      postMessageTool.execute?.(
        { target: { type: 'user', id }, message: 'lunch?' },
        { requestContext: ownerTurn(), observe: noopObserve }
      )
    )
  );
  for (const result of results) {
    expect(result).toMatchObject({ error: true });
  }
  expect(created).toHaveLength(0);
  expect(cards).toHaveLength(0);
});

test('targets render as Slack mentions the owner can check', () => {
  expect(renderTarget({ type: 'user', id: 'UOTHER' })).toBe('<@UOTHER>');
  expect(renderTarget({ type: 'channel', id: 'slack:C111' })).toBe('<#C111>');
  expect(renderTarget({ type: 'thread', id: current })).toBe(
    'a thread in <#C111> (ts 1700000000.000100)'
  );
});
