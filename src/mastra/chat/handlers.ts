import type { Author, Message, Thread } from 'chat';
import { writeAudit } from '../db/queries/audit';
import { logger } from '../lib/logger';
import { isOwner, isOwnerActor } from '../lib/owner';
import { isPaused } from '../lib/pause';
import { routeMessage } from '../lib/route';
import type { CommandThread } from '../types';
import { attachments } from './attachments';
import { enforceDailyCaps } from './caps';
import { slack } from './client';
import { handleCommand } from './commands';
import { withHistory } from './history';
import { isComment } from './message';
import { receptionistTurn } from './receptionist';
import { taintThread, threadState } from './state';

type RoutedThread = CommandThread &
  Pick<Thread, 'channelId' | 'state' | 'setState' | 'mentionUser'> & {
    messages: AsyncIterable<Message>;
    post: (text: string) => Promise<unknown>;
  };

type DefaultHandler<T> = (thread: T, message: Message) => Promise<void>;

function isFromBot(message: Message): boolean {
  return (
    message.author.isBot === true ||
    message.author.userId === 'USLACKBOT' ||
    message.author.isMe === true
  );
}

async function respond<T extends RoutedThread>({
  defaultHandler,
  message,
  thread,
  follow = false,
}: {
  defaultHandler: DefaultHandler<T>;
  message: Message;
  thread: T;
  follow?: boolean;
}): Promise<void> {
  const { text } = message;
  const history = await withHistory({ message: attachments(message), thread });
  const paused = (await isPaused()) || (await enforceDailyCaps());
  const route = routeMessage({
    authorId: message.author.userId,
    tainted: await taintThread({ thread, authorIds: history.authorIds }),
    paused,
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

  await writeAudit({ actor: 'owner', action: 'turn' }).catch((error: unknown) =>
    logger.error('[chat] could not audit an owner turn', { error })
  );

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

export async function onMention<T extends RoutedThread>(
  thread: T,
  message: Message,
  defaultHandler: DefaultHandler<T>
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

export async function onSubscribedMessage<T extends RoutedThread>(
  thread: T,
  message: Message,
  defaultHandler: DefaultHandler<T>
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

// Mastra's built-in tool approval buttons resume the run as whoever pressed
// them, so only the owner's presses reach the default handler.
export async function onAction(
  event: { user: Pick<Author, 'userId' | 'isBot'> | undefined },
  defaultHandler: () => Promise<void>
): Promise<void> {
  if (isOwnerActor(event.user)) {
    await defaultHandler();
  }
}

export async function onDirectMessage<T extends RoutedThread>(
  thread: T,
  message: Message,
  defaultHandler: DefaultHandler<T>
): Promise<void> {
  if (isFromBot(message)) {
    return;
  }
  await respond({ defaultHandler, message, thread });
}
