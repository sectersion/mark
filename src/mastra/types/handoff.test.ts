import { expect, test } from 'bun:test';
import { approvalPayloadSchemas, approvalSchema } from './handoff';

test('each kind accepts its own payload', () => {
  expect(
    approvalPayloadSchemas.request.safeParse({
      summary: 'wants to know if the demo is still on',
      wantsReply: true,
    }).success
  ).toBe(true);
  expect(
    approvalPayloadSchemas.standing_rule.safeParse({
      rule: 'never book meetings before 10am',
    }).success
  ).toBe(true);
  expect(
    approvalPayloadSchemas.outbound_message.safeParse({
      target: { type: 'channel', id: 'slack:C123' },
      text: 'hi all',
    }).success
  ).toBe(true);
});

test('a payload that does not match its kind is rejected', () => {
  expect(
    approvalPayloadSchemas.request.safeParse({ rule: 'be nice' }).success
  ).toBe(false);
  expect(
    approvalPayloadSchemas.standing_rule.safeParse({
      summary: 'hello',
      wantsReply: false,
    }).success
  ).toBe(false);
  expect(
    approvalPayloadSchemas.outbound_message.safeParse({
      target: { type: 'planet', id: 'mars' },
      text: 'hi',
    }).success
  ).toBe(false);
});

test('payload length limits hold', () => {
  expect(
    approvalPayloadSchemas.request.safeParse({
      summary: 'x'.repeat(501),
      wantsReply: true,
    }).success
  ).toBe(false);
  expect(
    approvalPayloadSchemas.standing_rule.safeParse({ rule: '' }).success
  ).toBe(false);
  expect(
    approvalPayloadSchemas.standing_rule.safeParse({ rule: 'x'.repeat(301) })
      .success
  ).toBe(false);
});

test('an approval row whose payload belongs to another kind is rejected', () => {
  const row = {
    id: '6f1c2c3e-8d7a-4b6e-9f0a-1b2c3d4e5f60',
    status: 'pending',
    requesterId: 'UOTHER',
    replyThread: null,
    cardChannel: null,
    cardTs: null,
    createdAt: new Date(),
    expiresAt: new Date(),
    decidedAt: null,
  };
  expect(
    approvalSchema.safeParse({
      ...row,
      kind: 'request',
      payload: { summary: 'hi', wantsReply: false },
    }).success
  ).toBe(true);
  expect(
    approvalSchema.safeParse({
      ...row,
      kind: 'standing_rule',
      payload: { summary: 'hi', wantsReply: false },
    }).success
  ).toBe(false);
  expect(
    approvalSchema.safeParse({
      ...row,
      kind: 'request',
      status: 'maybe',
      payload: { summary: 'hi', wantsReply: false },
    }).success
  ).toBe(false);
});
