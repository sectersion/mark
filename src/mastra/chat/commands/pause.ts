import type { Message, Thread } from 'chat';
import { agent as agentConfig } from '../../config';
import { logger } from '../../lib/logger';
import { isOwner } from '../../lib/owner';
import { pauseAll, resumeAll } from '../../lib/pause';
import type { CommandHandler } from '../../types';
import { getMastra } from '../mastra-instance';

async function reply({
  message,
  text,
  thread,
}: {
  message: Message;
  text: string;
  thread: Thread;
}): Promise<void> {
  await thread
    .postEphemeral(message.author, text, { fallbackToDM: false })
    .then(() => undefined)
    .catch((error: unknown) => {
      logger.warn('[commands] Failed to post pause feedback', {
        error,
        threadId: thread.id,
      });
    });
}

function failures(failed: string[]): string {
  return failed.length > 0 ? ` Failed: ${failed.join(', ')}.` : '';
}

export const pause: CommandHandler = async ({ message, thread }) => {
  const byId = message.author.userId;
  if (!isOwner(byId)) {
    return;
  }
  const outcome = await pauseAll({
    agentId: agentConfig.id,
    byId,
    schedules: getMastra().schedules,
  });
  const text =
    outcome.state === 'unchanged'
      ? 'Already paused. Use !resume to undo.'
      : `Paused. Writes are blocked and ${outcome.count} schedule(s) stopped.${failures(outcome.failed)} Use !resume to undo.`;
  await reply({ message, text, thread });
};

export const resume: CommandHandler = async ({ message, thread }) => {
  const byId = message.author.userId;
  if (!isOwner(byId)) {
    return;
  }
  const outcome = await resumeAll({
    byId,
    schedules: getMastra().schedules,
  });
  const text =
    outcome.state === 'unchanged'
      ? 'Not paused, nothing to resume.'
      : `Resumed. ${outcome.count} schedule(s) restarted.${failures(outcome.failed)}`;
  await reply({ message, text, thread });
};
