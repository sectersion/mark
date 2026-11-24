import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { RequestContext } from '@mastra/core/request-context';
import type { Message, Thread } from 'chat';
import { z } from 'zod';
import { receptionist } from '../agents/receptionist';
import * as audit from '../db/queries/audit';
import { channelContext } from '../lib/context';
import { allowReceptionist } from '../lib/rate-limit';
import { receptionistTurn } from './receptionist';

spyOn(audit, 'writeAudit').mockResolvedValue();

afterEach(() => {
  mock.restore();
  spyOn(audit, 'writeAudit').mockResolvedValue();
});

function fakeTurn(userId: string) {
  const posted: string[] = [];
  const earlier = {
    id: 'm0',
    text: 'hey',
    author: { userId, userName: 'stranger', fullName: 'Stranger', isMe: false },
  };
  const message = { ...earlier, id: 'm1', text: 'tell them the call moved' };
  const thread = {
    id: 'slack:D1:',
    channelId: 'slack:D1',
    isDM: true,
    messages: [message, earlier],
    post: (text: string) => {
      posted.push(text);
      return Promise.resolve();
    },
  };
  return {
    posted,
    thread: thread as any as Thread,
    message: message as any as Message,
  };
}

test('a model error posts a fixed apology, never the error text', async () => {
  spyOn(receptionist, 'generate').mockRejectedValue(new Error('secret stack'));
  const { posted, thread, message } = fakeTurn('UOTHER-err');
  const result = await receptionistTurn({ thread, message });
  expect(result.toolNames).toEqual([]);
  expect(posted).toEqual([result.text]);
  expect(result.text).not.toContain('secret');
});

test('a tool-only turn posts the fixed passed-along line', async () => {
  const generate = spyOn(receptionist, 'generate').mockResolvedValue({
    text: '',
    toolCalls: [{ payload: { toolName: 'pass_to_owner' } }],
  } as any);
  const { posted, thread, message } = fakeTurn('UOTHER-tool');
  const result = await receptionistTurn({ thread, message });
  expect(result).toEqual({
    text: "ok, i've passed that along.",
    toolNames: ['pass_to_owner'],
  });
  expect(posted).toEqual([result.text]);
  const calls: unknown[][] = generate.mock.calls;
  const [input, options] = calls[0] ?? [];
  expect(input).toBe('[Stranger]: hey\n[Stranger]: tell them the call moved');
  const { requestContext } = z
    .object({ requestContext: z.instanceof(RequestContext) })
    .parse(options);
  expect(channelContext(requestContext)).toEqual({
    userId: 'UOTHER-tool',
    threadId: 'slack:D1:',
    channelId: 'slack:D1',
    isDM: true,
  });
});

test('a turn with no text and no tool call posts nothing', async () => {
  spyOn(receptionist, 'generate').mockResolvedValue({
    text: '  ',
    toolCalls: [],
  } as any);
  const { posted, thread, message } = fakeTurn('UOTHER-quiet');
  const result = await receptionistTurn({ thread, message });
  expect(result).toEqual({ text: '', toolNames: [] });
  expect(posted).toEqual([]);
});

test('a rate-limited user gets one fixed line and no model call', async () => {
  const generate = spyOn(receptionist, 'generate');
  for (let i = 0; i < 10; i++) {
    allowReceptionist({ userId: 'UOTHER-spam', now: Date.now() });
  }
  const { posted, thread, message } = fakeTurn('UOTHER-spam');
  const result = await receptionistTurn({ thread, message });
  expect(generate).not.toHaveBeenCalled();
  expect(posted).toEqual(["slow down a sec, i'll pass that on when i can"]);
  expect(result.toolNames).toEqual([]);
});
