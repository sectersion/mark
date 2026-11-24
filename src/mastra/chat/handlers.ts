import type { Message, Thread } from 'chat';
import { logger } from '../lib/logger';
import { isOwner } from '../lib/owner';
import { isPaused } from '../lib/pause';
import { routeMessage } from '../lib/route';
import { attachments } from './attachments';
import { slack } from './client';
import { handleCommand } from './commands';
import { withHistory } from './history';
import { isComment } from './message';
import { receptionistTurn } from './receptionist';
import { taintThread, threadState } from './state';

type DefaultHandler = (thread: Thread, message: Message) => Promise<void>;

function isFromBot(message: Message): boolean {
  return (
    message.author.isBot === true ||
    message.author.userId === 'USLACKBOT' ||
    message.author.isMe === true
  );
}

async function respond({
  defaultHandler,
  message,
  thread,
  follow = false,
}: {
  defaultHandler: DefaultHandler;
  message: Message;
  thread: Thread;
  follow?: boolean;
}): Promise<void> {
  const { text } = message;
  const history = await withHistory({ message: attachments(message), thread });
  const route = routeMessage({
    authorId: message.author.userId,
    tainted: await taintThread({ thread, authorIds: history.authorIds }),
    paused: await isPaused(),
  });

  if (route === 'offline') {
    await thread.post('mark is offline.');
    return;
  }
  if (route === 'receptionist') {
    if (isOwner(message.author.userId)) {
      await thread.post(
        "that thread has other people in it, so i'm treating it as public. dm me to talk properly."
      );
    }
    try {
      await receptionistTurn({
        thread,
        message: { id: message.id, text, author: message.author },
      });
    } catch (error) {
      logger.error('[chat] receptionist turn failed', {
        error,
        threadId: thread.id,
      });
    }
    return;
  }

  if (follow) {
    await thread.setState({ respondOnThreadMessages: true });
  }
  if (await handleCommand({ message, thread })) {
    return;
  }
  logger.info('[chat] turn started', {
    threadId: thread.id,
    author: message.author.userName,
    attachments: message.attachments.map((attachment) => ({
      name: attachment.name,
      mimeType: attachment.mimeType,
      size: attachment.size,
      url: attachment.url ?? attachment.fetchMetadata?.url,
    })),
    text,
  });
  await defaultHandler(thread, history.message);
  // Only a turn that finished has seen the backfill; a failed one retries it.
  if (!thread.isDM) {
    await thread.setState({ lastSeenMessage: message.id });
  }
}

export async function onMention(
  thread: Thread,
  message: Message,
  defaultHandler: DefaultHandler
): Promise<void> {
  await taintThread({ thread, authorIds: [message.author.userId] });
  if (isFromBot(message)) {
    return;
  }
  await respond({
    defaultHandler,
    message,
    thread,
    follow: slack.decodeThreadId(message.threadId).threadTs === message.id,
  });
}

export async function onSubscribedMessage(
  thread: Thread,
  message: Message,
  defaultHandler: DefaultHandler
): Promise<void> {
  await taintThread({ thread, authorIds: [message.author.userId] });
  if (isFromBot(message) || isComment(message)) {
    return;
  }
  const state = await threadState(thread);
  const isFollowingThread = state?.respondOnThreadMessages === true;
  if (!(isFollowingThread || message.isMention)) {
    return;
  }
  await respond({ defaultHandler, message, thread });
}

export async function onDirectMessage(
  thread: Thread,
  message: Message,
  defaultHandler: DefaultHandler
): Promise<void> {
  if (isFromBot(message)) {
    return;
  }
  await respond({ defaultHandler, message, thread });
}
