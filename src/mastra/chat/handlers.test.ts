import { afterAll, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { Message, parseMarkdown } from 'chat';
import { logger } from '../lib/logger';

const realReceptionist = { ...(await import('./receptionist')) };
const realPause = { ...(await import('../lib/pause')) };
const realCommands = { ...(await import('./commands')) };
const realCaps = { ...(await import('./caps')) };
const realAudit = { ...(await import('../db/queries/audit')) };

let paused = false;
let receptionistFails = false;
const receptionistCalls: { text: string; userId: string }[] = [];
let commandCalls = 0;
let capsExceeded = false;
const audits: { actor: string; action: string }[] = [];

mock.module('./receptionist', () => ({
  ...realReceptionist,
  receptionistTurn: ({
    message,
  }: {
    message: { text: string; author: { userId: string } };
  }) => {
    receptionistCalls.push({
      text: message.text,
      userId: message.author.userId,
    });
    return receptionistFails
      ? Promise.reject(new Error('secret stack'))
      : Promise.resolve({ text: '', toolNames: [] });
  },
}));
mock.module('../lib/pause', () => ({
  ...realPause,
  isPaused: () => Promise.resolve(paused),
}));
mock.module('./caps', () => ({
  ...realCaps,
  enforceDailyCaps: () => Promise.resolve(capsExceeded),
}));
mock.module('../db/queries/audit', () => ({
  ...realAudit,
  writeAudit: (row: { actor: string; action: string }) => {
    audits.push(row);
    return Promise.resolve();
  },
}));
mock.module('./commands', () => ({
  ...realCommands,
  handleCommand: () => {
    commandCalls++;
    return Promise.resolve(false);
  },
}));

const { onAction, onDirectMessage, onMention, onSubscribedMessage } =
  await import('./handlers');

afterAll(() => {
  mock.module('./receptionist', () => realReceptionist);
  mock.module('../lib/pause', () => realPause);
  mock.module('./commands', () => realCommands);
  mock.module('./caps', () => realCaps);
  mock.module('../db/queries/audit', () => realAudit);
});

beforeEach(() => {
  paused = false;
  receptionistFails = false;
  receptionistCalls.length = 0;
  commandCalls = 0;
  capsExceeded = false;
  audits.length = 0;
});

function message({
  id,
  userId,
  text = 'hi',
  isBot = false,
  isMention,
  raw = {},
}: {
  id: string;
  userId: string;
  text?: string;
  isBot?: boolean;
  isMention?: boolean;
  raw?: Record<string, unknown>;
}): Message {
  return new Message({
    id,
    threadId: 'slack:C1:1.0',
    text,
    formatted: parseMarkdown(text),
    isMention,
    raw: { text, ...raw },
    author: { userId, userName: userId, fullName: userId, isBot, isMe: false },
    metadata: { dateSent: new Date(0), edited: false },
    attachments: [],
  });
}

function fakeThread({
  isDM = false,
  newestFirst = [],
}: {
  isDM?: boolean;
  newestFirst?: Message[];
} = {}) {
  let stored: Record<string, unknown> | null = null;
  const posted: string[] = [];
  const turns: string[] = [];
  const thread = {
    id: isDM ? 'slack:D1:' : 'slack:C1:1.0',
    channelId: isDM ? 'slack:D1' : 'slack:C1',
    isDM,
    get state() {
      return Promise.resolve(stored);
    },
    setState: (next: Record<string, unknown>) => {
      stored = { ...stored, ...next };
      return Promise.resolve();
    },
    mentionUser: (userId: string) => `<@${userId}>`,
    get messages() {
      return (async function* () {
        yield* newestFirst;
      })();
    },
    post: (text: string) => {
      posted.push(text);
      return Promise.resolve();
    },
    postEphemeral: () => Promise.resolve(null),
  };
  const defaultHandler = (_thread: typeof thread, turn: Message) => {
    turns.push(turn.text);
    return Promise.resolve();
  };
  return { thread, defaultHandler, posted, turns, stored: () => stored };
}

test('an untainted owner turn reaches mark and its commands', async () => {
  const current = message({ id: 'm1', userId: 'UOWNER' });
  const { thread, defaultHandler, turns } = fakeThread({
    newestFirst: [current],
  });
  await onMention(thread, current, defaultHandler);
  expect(turns).toHaveLength(1);
  expect(commandCalls).toBe(1);
  expect(receptionistCalls).toEqual([]);
});

test('a stranger in the history keeps the owner away from mark', async () => {
  const current = message({ id: 'm2', userId: 'UOWNER', text: 'do it' });
  const { thread, defaultHandler, posted, turns } = fakeThread({
    newestFirst: [current, message({ id: 'm1', userId: 'UOTHER' })],
  });
  await onMention(thread, current, defaultHandler);
  expect(turns).toEqual([]);
  expect(commandCalls).toBe(0);
  expect(receptionistCalls).toEqual([{ text: 'do it', userId: 'UOWNER' }]);
  expect(posted).toEqual([
    "that thread has other people in it, so i'm treating it as public. dm me to talk properly.",
  ]);
});

test('the receptionist gets the original text, not the history block', async () => {
  const current = message({ id: 'm2', userId: 'UOTHER', text: 'call moved' });
  const { thread, defaultHandler } = fakeThread({
    newestFirst: [current, message({ id: 'm1', userId: 'UOWNER' })],
  });
  await onMention(thread, current, defaultHandler);
  expect(current.text).toContain('[Recent messages');
  expect(receptionistCalls).toEqual([{ text: 'call moved', userId: 'UOTHER' }]);
});

test('a bot message taints the thread before it is ignored', async () => {
  const bot = message({ id: 'm1', userId: 'U0APP', isBot: true });
  const { thread, defaultHandler, stored } = fakeThread({
    newestFirst: [bot],
  });
  await onSubscribedMessage(thread, bot, defaultHandler);
  expect(stored()).toEqual({ tainted: true });
  expect(receptionistCalls).toEqual([]);
});

test('a stranger comment taints the thread before it is ignored', async () => {
  const comment = message({ id: 'm1', userId: 'UOTHER', text: '## aside' });
  const { thread, defaultHandler, stored } = fakeThread({
    newestFirst: [comment],
  });
  await onSubscribedMessage(thread, comment, defaultHandler);
  expect(stored()).toEqual({ tainted: true });
});

test('a bot mention taints the thread before it is ignored', async () => {
  const bot = message({ id: 'm1', userId: 'U0APP', isBot: true });
  const { thread, defaultHandler, stored } = fakeThread({
    newestFirst: [bot],
  });
  await onMention(thread, bot, defaultHandler);
  expect(stored()).toEqual({ tainted: true });
});

test('a stranger DM goes to the receptionist, never to commands', async () => {
  const current = message({ id: 'm1', userId: 'UOTHER', text: '!pause' });
  const { thread, defaultHandler, turns } = fakeThread({ isDM: true });
  await onDirectMessage(thread, current, defaultHandler);
  expect(turns).toEqual([]);
  expect(commandCalls).toBe(0);
  expect(receptionistCalls).toHaveLength(1);
});

test('a stranger while paused is told mark is offline', async () => {
  paused = true;
  const current = message({ id: 'm1', userId: 'UOTHER', text: '!resume' });
  const { thread, defaultHandler, posted, turns } = fakeThread({
    isDM: true,
  });
  await onDirectMessage(thread, current, defaultHandler);
  expect(posted).toEqual(['mark is offline.']);
  expect(turns).toEqual([]);
  expect(commandCalls).toBe(0);
  expect(receptionistCalls).toEqual([]);
});

test('a message with no author id never reaches mark', async () => {
  const current = message({ id: 'm1', userId: 'UOWNER' });
  Reflect.deleteProperty(current.author, 'userId');
  expect(current.author.userId).toBeUndefined();
  const { thread, defaultHandler, turns } = fakeThread({ isDM: true });
  await onDirectMessage(thread, current, defaultHandler);
  expect(turns).toEqual([]);
  expect(commandCalls).toBe(0);
  expect(receptionistCalls).toHaveLength(1);
});

test('a receptionist failure is caught and leaks nothing', async () => {
  receptionistFails = true;
  const current = message({ id: 'm1', userId: 'UOTHER' });
  const { thread, defaultHandler, posted } = fakeThread({ isDM: true });
  expect(await onDirectMessage(thread, current, defaultHandler)).toBe(
    undefined
  );
  expect(receptionistCalls).toHaveLength(1);
  expect(posted.join('\n')).not.toContain('secret');
});

test('an owner turn routed to mark is audited, without text', async () => {
  const current = message({ id: 'm9', userId: 'UOWNER', text: 'secret' });
  const { thread, defaultHandler } = fakeThread({ newestFirst: [current] });
  await onMention(thread, current, defaultHandler);
  expect(audits).toEqual([{ actor: 'owner', action: 'turn' }]);
});

test('an exceeded cap takes strangers offline and audits no turn', async () => {
  capsExceeded = true;
  const current = message({ id: 'm10', userId: 'UOTHER-cap' });
  const { thread, defaultHandler, posted } = fakeThread({
    newestFirst: [current],
  });
  await onMention(thread, current, defaultHandler);
  expect(posted).toEqual(['mark is offline.']);
  expect(receptionistCalls).toEqual([]);
  expect(audits).toEqual([]);
});

test('an exceeded cap never blocks the owner', async () => {
  capsExceeded = true;
  const current = message({ id: 'm11', userId: 'UOWNER' });
  const { thread, defaultHandler, turns } = fakeThread({
    newestFirst: [current],
  });
  await onMention(thread, current, defaultHandler);
  expect(turns).toHaveLength(1);
});

test('only the owner can press a built-in tool approval button', async () => {
  let pressed = 0;
  const press = () => {
    pressed++;
    return Promise.resolve();
  };
  const user = (userId: string, isBot = false) => ({
    user: { userId, userName: userId, fullName: userId, isBot, isMe: false },
  });
  await onAction(user('UOTHER'), press);
  await onAction(user('UOWNER', true), press);
  await onAction(user('B0APP', true), press);
  await onAction({ user: undefined }, press);
  expect(pressed).toBe(0);
  await onAction(user('UOWNER'), press);
  expect(pressed).toBe(1);
});

test('a stranger is told mark is offline once per window, not per message', async () => {
  paused = true;
  const first = fakeThread({ isDM: true });
  await onDirectMessage(
    first.thread,
    message({ id: 'm1', userId: 'UOTHER-repeat' }),
    first.defaultHandler
  );
  const second = fakeThread({ isDM: true });
  await onDirectMessage(
    second.thread,
    message({ id: 'm2', userId: 'UOTHER-repeat' }),
    second.defaultHandler
  );
  expect(first.posted).toEqual(['mark is offline.']);
  expect(second.posted).toEqual([]);
});

test('a followed thread ignores a stranger who does not address mark', async () => {
  const current = message({ id: 'm2', userId: 'UOTHER', text: 'lol' });
  const { thread, defaultHandler, posted } = fakeThread({
    newestFirst: [current],
  });
  await thread.setState({ respondOnThreadMessages: true });
  await onSubscribedMessage(thread, current, defaultHandler);
  expect(posted).toEqual([]);
  expect(receptionistCalls).toEqual([]);
});

test('a followed thread passes a stranger who mentions mark to the receptionist', async () => {
  const current = message({
    id: 'm2',
    userId: 'UOTHER',
    text: 'hey mark',
    isMention: true,
  });
  const { thread, defaultHandler } = fakeThread({ newestFirst: [current] });
  await thread.setState({ respondOnThreadMessages: true });
  await onSubscribedMessage(thread, current, defaultHandler);
  expect(receptionistCalls).toEqual([{ text: 'hey mark', userId: 'UOTHER' }]);
});

test('an app posting with the owner id is not the owner', async () => {
  const appPost = message({
    id: 'm1',
    userId: 'UOWNER',
    raw: { app_id: 'A0APP' },
  });
  const dm = fakeThread({ isDM: true });
  await onDirectMessage(dm.thread, appPost, dm.defaultHandler);
  expect(dm.turns).toEqual([]);
  expect(commandCalls).toBe(0);

  const channel = fakeThread({ newestFirst: [appPost] });
  await onMention(channel.thread, appPost, channel.defaultHandler);
  expect(channel.stored()).toEqual({ tainted: true });
  expect(channel.turns).toEqual([]);
});

test('an app post with the owner id in the history taints the thread', async () => {
  const current = message({ id: 'm2', userId: 'UOWNER' });
  const { thread, defaultHandler, turns } = fakeThread({
    newestFirst: [
      current,
      message({ id: 'm1', userId: 'UOWNER', raw: { bot_profile: {} } }),
    ],
  });
  await onMention(thread, current, defaultHandler);
  expect(turns).toEqual([]);
  expect(receptionistCalls).toEqual([{ text: 'hi', userId: 'UOWNER' }]);
});

test("an owner turn logs ids and sizes, never the owner's text", async () => {
  const logged: unknown[] = [];
  const info = spyOn(logger, 'info').mockImplementation((...args) => {
    logged.push(args);
  });
  const current = message({ id: 'm12', userId: 'UOWNER', text: 'my secret' });
  const { thread, defaultHandler } = fakeThread({ newestFirst: [current] });
  await onMention(thread, current, defaultHandler);
  info.mockRestore();
  expect(logged).toContainEqual([
    '[chat] turn started',
    {
      threadId: 'slack:C1:1.0',
      messageId: 'm12',
      textLength: 'my secret'.length,
      attachments: 0,
    },
  ]);
  expect(JSON.stringify(logged)).not.toContain('secret');
});
