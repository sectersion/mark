import type { Message, Thread } from 'chat';
import { parseMarkdown, stringifyMarkdown } from 'chat';
import { isComment } from './message';
import { threadState } from './state';

const MAX_MESSAGES = 10;
const MAX_SCANNED = 30;

export async function withHistory({
  message,
  thread,
}: {
  message: Message;
  thread: Pick<Thread, 'isDM' | 'state' | 'messages' | 'mentionUser'>;
}): Promise<{ message: Message; authorIds: (string | undefined)[] }> {
  if (thread.isDM) {
    return { message, authorIds: [] };
  }

  const state = await threadState(thread);
  const lines: string[] = [];
  const authorIds: (string | undefined)[] = [];
  let scanned = 0;
  let comments = 0;
  let truncated = false;
  for await (const previous of thread.messages) {
    if (previous.id === state?.lastSeenMessage) {
      break;
    }
    if (scanned >= MAX_SCANNED) {
      truncated = true;
      // Whoever wrote the messages past the window is unknown, so fail closed.
      authorIds.push(undefined);
      break;
    }
    scanned++;
    if (!previous.author.isMe) {
      authorIds.push(previous.author.userId);
    }
    if (isComment(previous)) {
      comments++;
      continue;
    }
    if (previous.id === message.id || previous.author.isMe) {
      continue;
    }
    if (lines.length >= MAX_MESSAGES) {
      truncated = true;
      continue;
    }
    const mention = thread.mentionUser(previous.author.userId);
    const author = previous.author.fullName || previous.author.userName;
    const bot = previous.author.isBot === true ? ' (bot)' : '';
    const text = previous.formatted
      ? stringifyMarkdown(previous.formatted).trim()
      : previous.text;
    const files =
      previous.attachments.length > 0
        ? ` [${previous.attachments.length} attachment${previous.attachments.length === 1 ? '' : 's'}: ${previous.attachments
            .map((file) => {
              const url = file.url ?? file.fetchMetadata?.url;
              const id = url?.match(/\bF[A-Z0-9]{6,}\b/)?.[0];
              return [file.name ?? file.type, id ?? url]
                .filter(Boolean)
                .join(' ');
            })
            .join(', ')}]`
        : '';
    lines.push(
      `[${author} (${mention})${bot}] (msg:${previous.id}): ${text}${files}`
    );
  }

  if (lines.length === 0 && comments === 0) {
    return { message, authorIds };
  }

  const text = [
    ...(lines.length > 0
      ? [
          '[Recent messages in this thread, oldest first, that you have not seen yet]',
          ...(truncated
            ? [
                '[Older unseen messages were left out. Read them with read_conversation_history if they matter.]',
              ]
            : []),
          ...lines.reverse(),
        ]
      : []),
    ...(comments > 0
      ? [
          `[${comments} ${comments === 1 ? 'message' : 'messages'} starting with ## were left out. They are side comments nobody addressed to you, so act on them only if asked. Read them with read_conversation_history and includeComments if you need them.]`,
        ]
      : []),
    '',
    message.text,
  ].join('\n');
  message.text = text;
  message.formatted = parseMarkdown(text);
  return { message, authorIds };
}
