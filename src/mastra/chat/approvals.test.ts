import { expect, test } from 'bun:test';
import type { Approval } from '../types';
import { buttonDecision, escapeMrkdwn, expiredByPress } from './approvals';

const id = '0b6f1c8e-3f5a-4d2b-9c1e-7a8b9c0d1e2f';

const expiredRequest: Approval = {
  id,
  kind: 'request',
  status: 'expired',
  payload: { summary: 'can we move the call', wantsReply: true },
  requesterId: 'UOTHER',
  replyThread: 'slack:C1:1.1',
  cardChannel: 'D1',
  cardTs: '1.2',
  createdAt: new Date(0),
  expiresAt: new Date(0),
  decidedAt: null,
};

test('expiredByPress returns the row only when the press expired it', () => {
  expect(expiredByPress({ result: 'expired', approval: expiredRequest })).toBe(
    expiredRequest
  );
  expect(expiredByPress({ result: 'expired' })).toBeUndefined();
  expect(
    expiredByPress({ result: 'ok', approval: expiredRequest })
  ).toBeUndefined();
  expect(expiredByPress({ result: 'already_resolved' })).toBeUndefined();
  expect(expiredByPress({ result: 'not_found' })).toBeUndefined();
  expect(expiredByPress({ result: 'forbidden' })).toBeUndefined();
});

test('buttonDecision reads the decision and approval id from a button', () => {
  expect(buttonDecision({ actionId: 'approval_approve', value: id })).toEqual({
    id,
    decision: 'approved',
  });
  expect(buttonDecision({ actionId: 'approval_decline', value: id })).toEqual({
    id,
    decision: 'declined',
  });
});

test('buttonDecision rejects a missing or empty value', () => {
  expect(
    buttonDecision({ actionId: 'approval_approve', value: undefined })
  ).toBeUndefined();
  expect(
    buttonDecision({ actionId: 'approval_approve', value: '' })
  ).toBeUndefined();
});

test('buttonDecision rejects an unknown action id', () => {
  expect(
    buttonDecision({ actionId: 'opt_in_accept', value: id })
  ).toBeUndefined();
  expect(
    buttonDecision({ actionId: `tool_approve:${id}`, value: id })
  ).toBeUndefined();
});

test('buttonDecision rejects an id that is not a uuid', () => {
  expect(
    buttonDecision({ actionId: 'approval_approve', value: 'not-a-uuid' })
  ).toBeUndefined();
  expect(
    buttonDecision({ actionId: 'approval_decline', value: `${id}x` })
  ).toBeUndefined();
});

test('escapeMrkdwn neutralizes mentions, links and entities', () => {
  expect(
    escapeMrkdwn('hey <!channel> and <@U123> see <https://x.io|here>')
  ).toBe(
    'hey &lt;!channel&gt; and &lt;@U123&gt; see &lt;https://x.io|here&gt;'
  );
  expect(escapeMrkdwn('a &lt; b & c')).toBe('a &amp;lt; b &amp; c');
  expect(escapeMrkdwn('plain words')).toBe('plain words');
});
