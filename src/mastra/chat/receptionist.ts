import { RequestContext } from '@mastra/core/request-context';
import type { Author, Message, Thread } from 'chat';
import { receptionist } from '../agents/receptionist';
import { writeAudit } from '../db/queries/audit';
import { logger } from '../lib/logger';
import { allowReceptionist } from '../lib/rate-limit';
import { passToOwnerTurnKey } from '../tools/receptionist/pass-to-owner';

export const failureLine =
  'sorry, something went wrong on my end. try again in a bit';

type TurnMessage = Pick<Message, 'id' | 'text'> & {
  author: Pick<Author, 'userId' | 'userName' | 'fullName' | 'isMe'>;
};

export async function receptionistTurn({
  thread,
  message,
}: {
  thread: Pick<Thread, 'id' | 'channelId' | 'isDM'> & {
    messages: AsyncIterable<TurnMessage>;
    post: (text: string) => Promise<unknown>;
  };
  message: TurnMessage;
}): Promise<{ text: string; toolNames: string[] }> {
  const { userId } = message.author;
  if (!allowReceptionist({ userId, now: Date.now() })) {
    const text = "slow down a sec, i'll pass that on when i can";
    await thread.post(text);
    return { text, toolNames: [] };
  }

  const earlier: string[] = [];
  for await (const previous of thread.messages) {
    if (earlier.length >= 5) {
      break;
    }
    if (previous.id !== message.id) {
      earlier.push(
        `[${previous.author.isMe ? 'you' : previous.author.fullName || previous.author.userName}]: ${previous.text}`
      );
    }
  }
  const author = message.author.fullName || message.author.userName;
  const input = [...earlier.reverse(), `[${author}]: ${message.text}`].join(
    '\n'
  );

  const requestContext = new RequestContext();
  requestContext.set('channel', {
    userId,
    threadId: thread.id,
    channelId: thread.channelId,
    isDM: thread.isDM,
  });
  requestContext.set(passToOwnerTurnKey, { passed: false });

  let text = failureLine;
  let toolNames: string[] = [];
  try {
    const result = await receptionist.generate(input, { requestContext });
    toolNames = result.toolCalls.map((call) => call.payload.toolName);
    text =
      result.text.trim() ||
      (toolNames.includes('pass_to_owner')
        ? "ok, i've passed that along."
        : '');
  } catch (error) {
    logger.error('[receptionist] turn failed', { error, threadId: thread.id });
  }
  if (text) {
    await thread.post(text);
  }
  await writeAudit({
    actor: 'receptionist',
    action: 'receptionist.reply',
    detail: { threadId: thread.id, requesterId: userId, toolNames },
  });
  return { text, toolNames };
}
