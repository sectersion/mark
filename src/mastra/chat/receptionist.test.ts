import { afterAll, beforeEach, expect, mock, test } from 'bun:test';
import { RequestContext } from '@mastra/core/request-context';
import type { Message, Thread } from 'chat';
import { z } from 'zod';
import { channelContext } from '../lib/context';
import { allowReceptionist } from '../lib/rate-limit';
import { passToOwnerTurnKey } from '../tools/receptionist/pass-to-owner';

const realAgent = { ...(await import('../agents/receptionist')) };
const realAudit = { ...(await import('../db/queries/audit')) };

interface Reply {
  text: string;
  toolCalls: { payload: { toolName: string } }[];
}

let reply: () => Promise<Reply> = () =>
  Promise.resolve({ text: '', toolCalls: [] });
const calls: { input: unknown; requestContext: unknown }[] = [];

mock.module('../agents/receptionist', () => ({
  ...realAgent,
  receptionist: {
    generate: (input: unknown, options: { requestContext: unknown }) => {
      calls.push({ input, requestContext: options.requestContext });
      return reply();
    },
  },
}));
mock.module('../db/queries/audit', () => ({
  ...realAudit,
  writeAudit: () => Promise.resolve(),
}));

const { receptionistTurn } = await import('./receptionist');

afterAll(() => {
  mock.module('../agents/receptionist', () => realAgent);
  mock.module('../db/queries/audit', () => realAudit);
});

beforeEach(() => {
  calls.length = 0;
});

function fakeTurn(userId: string) {
  const posted: string[] = [];
  const author = {
    userId,
    userName: 'stranger',
    fullName: 'Stranger',
    isMe: false,
  };
  const earlier = { id: 'm0', text: 'hey', author };
  const message = { id: 'm1', text: 'tell them the call moved', author };
  const thread = {
    id: 'slack:D1:',
    channelId: 'slack:D1',
    isDM: true,
    // biome-ignore lint/suspicious/useAwait: a fake async iterable has nothing to await
    messages: (async function* () {
      yield message;
      yield earlier;
    })(),
    post: (text: string) => {
      posted.push(text);
      return Promise.resolve();
    },
  };
  return { posted, thread, message };
}

function turnContext(index: number) {
  const { requestContext } = z
    .object({ requestContext: z.instanceof(RequestContext) })
    .parse(calls[index]);
  return requestContext;
}

test('real chat Thread and Message fit', () => {
  const call = (args: { thread: Thread; message: Message }) =>
    receptionistTurn(args);
  expect(call).toBeFunction();
});

test('a model error posts a fixed apology, never the error text', async () => {
  reply = () => Promise.reject(new Error('secret stack'));
  const { posted, thread, message } = fakeTurn('UOTHER-err');
  const result = await receptionistTurn({ thread, message });
  expect(result.toolNames).toEqual([]);
  expect(posted).toEqual([result.text]);
  expect(result.text).not.toContain('secret');
});

test('a tool-only turn posts the fixed passed-along line', async () => {
  reply = () =>
    Promise.resolve({
      text: '',
      toolCalls: [{ payload: { toolName: 'pass_to_owner' } }],
    });
  const { posted, thread, message } = fakeTurn('UOTHER-tool');
  const result = await receptionistTurn({ thread, message });
  expect(result).toEqual({
    text: "ok, i've passed that along.",
    toolNames: ['pass_to_owner'],
  });
  expect(posted).toEqual([result.text]);
  expect(calls[0]?.input).toBe(
    '[Stranger]: hey\n[Stranger]: tell them the call moved'
  );
  expect(channelContext(turnContext(0))).toEqual({
    userId: 'UOTHER-tool',
    threadId: 'slack:D1:',
    channelId: 'slack:D1',
    isDM: true,
  });
});

test('every turn gets a fresh request context', async () => {
  reply = () => Promise.resolve({ text: 'hi', toolCalls: [] });
  await receptionistTurn(fakeTurn('UOTHER-one'));
  await receptionistTurn(fakeTurn('UOTHER-two'));
  const first: unknown = turnContext(0).get(passToOwnerTurnKey);
  const second: unknown = turnContext(1).get(passToOwnerTurnKey);
  expect(first).not.toBe(second);
  expect(second).toEqual({ passed: false });
});

test('a turn with no text and no tool call posts nothing', async () => {
  reply = () => Promise.resolve({ text: '  ', toolCalls: [] });
  const { posted, thread, message } = fakeTurn('UOTHER-quiet');
  const result = await receptionistTurn({ thread, message });
  expect(result).toEqual({ text: '', toolNames: [] });
  expect(posted).toEqual([]);
});

test('a rate-limited user gets one fixed line and no model call', async () => {
  for (let i = 0; i < 10; i++) {
    allowReceptionist({ userId: 'UOTHER-spam', now: Date.now() });
  }
  const { posted, thread, message } = fakeTurn('UOTHER-spam');
  const result = await receptionistTurn({ thread, message });
  expect(calls).toHaveLength(0);
  expect(posted).toEqual(["slow down a sec, i'll pass that on when i can"]);
  expect(result.toolNames).toEqual([]);
});

test('a rate-limited user is told to slow down only once per window', async () => {
  for (let i = 0; i < 10; i++) {
    allowReceptionist({ userId: 'UOTHER-flood', now: Date.now() });
  }
  const first = fakeTurn('UOTHER-flood');
  await receptionistTurn({ thread: first.thread, message: first.message });
  const second = fakeTurn('UOTHER-flood');
  const result = await receptionistTurn({
    thread: second.thread,
    message: second.message,
  });
  expect(first.posted).toHaveLength(1);
  expect(second.posted).toEqual([]);
  expect(result).toEqual({ text: '', toolNames: [] });
  expect(calls).toHaveLength(0);
});
