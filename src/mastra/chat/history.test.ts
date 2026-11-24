import { expect, test } from 'bun:test';
import { Message, parseMarkdown } from 'chat';
import { withHistory } from './history';

function message({
  id,
  userId,
  text = 'hi',
  isMe = false,
}: {
  id: string;
  userId: string;
  text?: string;
  isMe?: boolean;
}): Message {
  return new Message({
    id,
    threadId: 'slack:C1:1.0',
    text,
    formatted: parseMarkdown(text),
    raw: { text },
    author: { userId, userName: userId, fullName: userId, isBot: isMe, isMe },
    metadata: { dateSent: new Date(0), edited: false },
    attachments: [],
  });
}

function fakeThread({
  newestFirst,
  isDM = false,
}: {
  newestFirst: Message[];
  isDM?: boolean;
}) {
  return {
    isDM,
    state: Promise.resolve(null),
    mentionUser: (userId: string) => `<@${userId}>`,
    messages: (async function* () {
      yield* newestFirst;
    })(),
  };
}

test('authorIds covers people and comments but not mark itself', async () => {
  const current = message({ id: 'm4', userId: 'UOWNER' });
  const thread = fakeThread({
    newestFirst: [
      current,
      message({ id: 'm3', userId: 'U0MARK', isMe: true }),
      message({ id: 'm2', userId: 'UOTHER', text: '## aside' }),
      message({ id: 'm1', userId: 'USLACKBOT' }),
    ],
  });
  const { authorIds } = await withHistory({ message: current, thread });
  expect(authorIds).toEqual(['UOWNER', 'UOTHER', 'USLACKBOT']);
});

test('a scan cut short by the window adds an unknown author', async () => {
  const current = message({ id: 'm40', userId: 'UOWNER' });
  const older = Array.from({ length: 39 }, (_, i) =>
    message({ id: `m${39 - i}`, userId: 'UOWNER' })
  );
  const thread = fakeThread({ newestFirst: [current, ...older] });
  const { authorIds } = await withHistory({ message: current, thread });
  expect(authorIds).toContain(undefined);
});

test('a DM has no authors to check', async () => {
  const current = message({ id: 'm1', userId: 'UOTHER' });
  const thread = fakeThread({ newestFirst: [current], isDM: true });
  expect(await withHistory({ message: current, thread })).toEqual({
    message: current,
    authorIds: [],
  });
});
