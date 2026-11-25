import { SlackFormatConverter } from '@chat-adapter/slack';
import type { RequestContext } from '@mastra/core/request-context';
import type { Message } from 'chat';
import { z } from 'zod';
import { env } from '@/env';
import { slack } from '../../chat/client';
import { chat } from '../../chat/instance';
import { resolveTarget } from '../../chat/target';
import { chatChannelId, parseSlackId, rawId, threadIdOf } from '../../lib/ids';
import { logger } from '../../lib/logger';
import { isOwner } from '../../lib/owner';
import type { ChannelContext, Target } from '../../types';

export const slackErrorSchema = z.looseObject({
  data: z.looseObject({ error: z.string().optional() }).optional(),
});
const notReadable =
  'Reading DMs, private channels, or external conversations is not allowed.';

export async function assertReadableChannel({
  channelId,
  currentThreadId,
}: {
  channelId: string;
  currentThreadId?: string;
}) {
  const id = chatChannelId(channelId);
  const metadata = await chat().channel(id).fetchMetadata();
  if (currentThreadId && id === chatChannelId(currentThreadId)) {
    return metadata;
  }

  if (metadata.channelVisibility === 'workspace') {
    return metadata;
  }

  throw new Error(notReadable);
}

export async function assertReadableResource({
  channelIds,
  currentThreadId,
}: {
  channelIds: string[];
  currentThreadId?: string;
}): Promise<void> {
  if (channelIds.length === 0) {
    throw new Error('This Slack resource is not associated with a channel.');
  }

  const checks = await Promise.allSettled(
    channelIds.map((channelId) =>
      assertReadableChannel({ channelId, currentThreadId })
    )
  );
  if (checks.some((check) => check.status === 'fulfilled')) {
    return;
  }

  // Still refused either way. A rate limit or timeout just must not read as
  // "this conversation is private".
  const failed = checks.find(
    (check) =>
      check.status === 'rejected' &&
      check.reason?.message !== notReadable &&
      slackErrorSchema.safeParse(check.reason).data?.data?.error !==
        'channel_not_found'
  );
  if (failed?.status === 'rejected') {
    throw new Error(
      'Could not check whether this Slack resource is readable, so it was not opened. This says nothing about whether it is private. Retry before concluding anything.',
      { cause: failed.reason }
    );
  }

  throw new Error(
    'Reading or editing Slack resources from another private conversation is not allowed.'
  );
}

export function canPostDirect({
  targetThreadId,
  targetChannelId,
  currentThreadId,
  ownerDmChannelId,
}: {
  targetThreadId: string | undefined;
  targetChannelId: string | undefined;
  currentThreadId: string | undefined;
  ownerDmChannelId: string | undefined;
}): boolean {
  if (targetThreadId !== undefined && targetThreadId === currentThreadId) {
    return true;
  }
  return (
    targetChannelId !== undefined &&
    ownerDmChannelId !== undefined &&
    rawId(targetChannelId) === rawId(ownerDmChannelId)
  );
}

let ownerDm: Promise<string | undefined> | undefined;

export function ownerDmChannelId(): Promise<string | undefined> {
  const pending =
    ownerDm ??
    chat()
      .openDM(env.OWNER_SLACK_USER_ID)
      .then((dm) => slack.decodeThreadId(dm.id).channel)
      .catch((error: unknown): undefined => {
        // Undefined fails the outbound check closed; forget it so the next
        // call retries instead of every post waiting on approval until a
        // restart.
        ownerDm = undefined;
        logger.warn("[slack] could not open the owner's DM", { error });
      });
  ownerDm = pending;
  return pending;
}

export async function isDirectTarget({
  target,
  ctx,
}: {
  target: Target;
  ctx: ChannelContext;
}): Promise<boolean> {
  const ownerDmId = await ownerDmChannelId();
  if (target.type === 'user') {
    return canPostDirect({
      targetThreadId: undefined,
      targetChannelId: isOwner(rawId(target.id)) ? ownerDmId : undefined,
      currentThreadId: ctx.threadId,
      ownerDmChannelId: ownerDmId,
    });
  }
  return canPostDirect({
    targetThreadId: target.type === 'thread' ? target.id : undefined,
    targetChannelId:
      target.type === 'thread' ? parseSlackId(target.id).channel : target.id,
    currentThreadId: ctx.threadId,
    ownerDmChannelId: ownerDmId,
  });
}

// Safe to send unescaped only because targetSchema limits ids to bare Slack ids.
export function renderTarget(target: Target): string {
  if (target.type === 'user') {
    return `<@${rawId(target.id)}>`;
  }
  const { ts } = parseSlackId(target.id);
  if (target.type === 'thread' && ts) {
    return `a thread in <#${rawId(target.id)}> (ts ${ts})`;
  }
  return `<#${rawId(target.id)}>`;
}

const markdownConverter = new SlackFormatConverter();

let cachedBotName: string | undefined;

async function botDisplayName(botUserId: string | undefined): Promise<string> {
  if (cachedBotName) {
    return cachedBotName;
  }
  if (!botUserId) {
    return 'mark';
  }
  const info = await slack.webClient.users
    .info({ user: botUserId })
    .catch(() => null);
  const profile = info?.user?.profile;
  const name = profile?.display_name || profile?.real_name || info?.user?.name;
  if (!name) {
    return 'mark';
  }
  cachedBotName = name;
  return name;
}

async function resolveChannelAndThread(
  target: Target
): Promise<{ channel: string; threadTs?: string }> {
  if (target.type === 'thread') {
    const { channel, ts } = parseSlackId(target.id);
    if (!channel) {
      throw new Error(`${target.id} is not a Slack thread id.`);
    }
    return { channel, threadTs: ts };
  }
  if (target.type === 'channel') {
    return { channel: rawId(target.id) };
  }
  const dm = await resolveTarget(target);
  return { channel: rawId(dm.id) };
}

export async function sendMessage({
  target,
  markdown,
  ctx,
}: {
  target: Target;
  markdown: string;
  ctx: ChannelContext;
}): Promise<{ messageId: string; threadId: string | undefined }> {
  if (target.type !== 'user') {
    await joinChannel({ channelId: target.id });
  }
  const { channel, threadTs } = await resolveChannelAndThread(target);
  const requesterUser = ctx.userId
    ? await chat()
        .getUser(ctx.userId)
        .catch(() => null)
    : null;
  const requester = requesterUser?.userName ?? ctx.userName;
  const bot = await botDisplayName(ctx.botUserId);
  const credited = Boolean(requester) && target.type !== 'user';
  const username = credited ? `${requester} [${bot}]` : bot;
  const sent = await slack.webClient.chat.postMessage({
    channel,
    ...(threadTs ? { thread_ts: threadTs } : {}),
    ...markdownConverter.toSlackPayload({ markdown }),
    ...(credited && requesterUser?.avatarUrl
      ? { icon_url: requesterUser.avatarUrl }
      : {}),
    username,
  });
  if (!sent.ts) {
    throw new Error('Slack posted the message without returning its id.');
  }
  return {
    messageId: sent.ts,
    threadId: threadTs ? threadIdOf({ channel, ts: threadTs }) : undefined,
  };
}

export const slackReadOnlyKey = 'slackReadOnly';

const joinedChannels = new Set<string>();

export async function joinChannel({
  channelId,
  requestContext,
}: {
  channelId: string;
  requestContext?: RequestContext;
}): Promise<void> {
  // Joining posts a visible "joined" message in that channel, so read-only
  // code mode never does it.
  if (requestContext?.get(slackReadOnlyKey) === true) {
    return;
  }
  const id = rawId(channelId);
  if (joinedChannels.has(id)) {
    return;
  }
  try {
    await slack.webClient.conversations.join({ channel: id });
    joinedChannels.add(id);
  } catch (error) {
    // already_in_channel means the bot is already a member, the state we want,
    // so remember it and stop re-calling join. Other failures may be transient,
    // so do not cache and let a later call retry.
    if (
      slackErrorSchema.safeParse(error).data?.data?.error ===
      'already_in_channel'
    ) {
      joinedChannels.add(id);
      return;
    }
    logger.debug('[slack] could not join the channel', { channelId, error });
  }
}

export function slackThreadId({
  channelId,
  threadId,
}: {
  channelId?: string;
  threadId: string;
}): string {
  return threadIdOf(parseSlackId(threadId, { channel: channelId })) ?? threadId;
}

export function formatMessage(message: Message) {
  return {
    id: message.id,
    threadId: message.threadId,
    text: message.text,
    author: {
      userId: message.author.userId,
      userName: message.author.userName,
      fullName: message.author.fullName,
      isBot: message.author.isBot,
      isMe: message.author.isMe,
    },
    dateSent: message.metadata.dateSent.toISOString(),
    edited: message.metadata.edited,
    isMention: message.isMention,
    attachments: message.attachments.map((a) => ({
      type: a.type,
      name: a.name,
      mimeType: a.mimeType,
      url: a.url,
    })),
  };
}
