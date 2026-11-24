import { afterAll, beforeEach, expect, mock, test } from 'bun:test';
import { Message, parseMarkdown } from 'chat';

const realReceptionist = { ...(await import('./receptionist')) };
const realPause = { ...(await import('../lib/pause')) };
const realCommands = { ...(await import('./commands')) };

let paused = false;
let receptionistFails = false;
const receptionistCalls: { text: string; userId: string }[] = [];
let commandCalls = 0;

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
mock.module('./commands', () => ({
  ...realCommands,
  handleCommand: () => {
    commandCalls++;
    return Promise.resolve(false);
  },
}));

const { onDirectMessage, onMention, onSubscribedMessage } = await import(
  './handlers'
);

afterAll(() => {
  mock.module('./receptionist', () => realReceptionist);
  mock.module('../lib/pause', () => realPause);
  mock.module('./commands', () => realCommands);
});

beforeEach(() => {
  paused = false;
  receptionistFails = false;
  receptionistCalls.length = 0;
  commandCalls = 0;
});

function message({
  id,
  userId,
  text = 'hi',
  isBot = false,
}: {
  id: string;
  userId: string;
  text?: string;
  isBot?: boolean;
}): Message {
  return new Message({
    id,
    threadId: 'slack:C1:1.0',
    text,
    formatted: parseMarkdown(text),
    raw: { text },
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
