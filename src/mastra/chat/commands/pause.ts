import type { Message, Thread } from 'chat';
import { agent as agentConfig } from '../../config';
import { logger } from '../../lib/logger';
import { isOwner } from '../../lib/owner';
import { latestPausedScheduleIds, setPaused } from '../../lib/pause';
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

export const pause: CommandHandler = async ({ message, thread }) => {
  const byId = message.author.userId;
  if (!isOwner(byId)) {
    return;
  }
  const { schedules } = getMastra();
  const active = await schedules.list({
    agentId: agentConfig.id,
    status: 'active',
  });
  const scheduleIds = active.map((schedule) => schedule.id);
  await setPaused({ paused: true, byId, scheduleIds });
  await Promise.all(scheduleIds.map((id) => schedules.pause(id)));
  await reply({
    message,
    text: `Paused. Writes are blocked and ${scheduleIds.length} schedule(s) stopped. Use !resume to undo.`,
    thread,
  });
};

export const resume: CommandHandler = async ({ message, thread }) => {
  const byId = message.author.userId;
  if (!isOwner(byId)) {
    return;
  }
  const scheduleIds = await latestPausedScheduleIds();
  await setPaused({ paused: false, byId });
  const { schedules } = getMastra();
  await Promise.all(scheduleIds.map((id) => schedules.resume(id)));
  await reply({
    message,
    text: `Resumed. ${scheduleIds.length} schedule(s) restarted.`,
    thread,
  });
};
