import type { Message } from 'chat';
import type { CommandHandler, CommandThread } from '../../types';
import { rawText, withoutLeadingMentions } from '../message';
import { connections } from './connections';
import { help } from './help';
import { pause, resume } from './pause';
import { stop } from './stop';

const commands: Record<string, CommandHandler> = {
  connections,
  help,
  mcps: connections,
  pause,
  resume,
  stop,
};

export async function handleCommand({
  message,
  thread,
}: {
  message: Message;
  thread: CommandThread;
}): Promise<boolean> {
  const body = withoutLeadingMentions(rawText(message)).trim();
  const match = body.match(/^!(\w+)\b/i);
  const command = match?.[1] ? commands[match[1].toLowerCase()] : undefined;
  if (!command) {
    return false;
  }
  await command({ message, thread });
  return true;
}
