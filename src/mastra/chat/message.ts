import type { Message } from 'chat';
import { z } from 'zod';

const slackRawText = z.looseObject({ text: z.string() });

const slackRawSender = z.looseObject({
  app_id: z.unknown().optional(),
  bot_id: z.unknown().optional(),
  bot_profile: z.unknown().optional(),
});

// An app holding the owner's user token posts with the owner's user id, so
// any app or bot marker on the raw event means it is not the owner typing.
export function isAppPost(message: Pick<Message, 'raw'>): boolean {
  const raw = slackRawSender.safeParse(message.raw);
  return (
    raw.success &&
    Boolean(raw.data.app_id || raw.data.bot_id || raw.data.bot_profile)
  );
}

export function authorId(
  message: Pick<Message, 'raw' | 'author'>
): string | undefined {
  return isAppPost(message) ? undefined : message.author.userId;
}

export function rawText(message: Message): string {
  const raw = slackRawText.safeParse(message.raw);
  return raw.success ? raw.data.text : message.text;
}

export function withoutLeadingMentions(text: string): string {
  return text.replace(/^\s*(?:<@[A-Z0-9][A-Z0-9._-]*(?:\|[^>]+)?>\s*)+/, '');
}

export function isComment(message: Message): boolean {
  const [first] = rawText(message)
    .split('\n')
    .filter((line) => line.trim());
  return (
    first !== undefined &&
    withoutLeadingMentions(first).trimStart().startsWith('##')
  );
}
