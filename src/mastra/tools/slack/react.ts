import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { slack } from '../../chat/client';
import { auditSend } from '../../lib/audit-send';
import { channelContext } from '../../lib/context';
import { chatChannelId, parseSlackId, threadIdOf } from '../../lib/ids';
import { input, output } from '../../types/tools/index';
import { canPostDirect, ownerDmChannelId } from './utils';

export const reactTool = createTool({
  id: 'react',
  description:
    "Add or remove an emoji reaction on a Slack message by current channel timestamp, channel/message id, or message URL. Only the message you are answering, the current thread's first message, or messages in the owner's own DM.",
  inputSchema: input({
    channelId: z
      .string()
      .optional()
      .describe(
        'Slack channel id. Defaults to the current channel if omitted.'
      ),
    messageId: z
      .string()
      .optional()
      .describe('Slack message timestamp. Required unless url is given.'),
    url: z
      .url()
      .optional()
      .describe('Slack message URL, instead of channelId/messageId.'),
    action: z.enum(['add', 'remove']).default('add'),
    emoji: z.string().min(1).describe('Emoji name without colons.'),
  }),
  outputSchema: output({
    action: z.enum(['add', 'remove']),
    channelId: z.string(),
    messageId: z.string(),
    emoji: z.string(),
  }),
  transform: {
    display: {
      output: ({ output }) => ({
        summary: `${output?.action === 'remove' ? 'Removed' : 'Added'} :${output?.emoji ?? ''}:`,
      }),
    },
  },
  execute: async (
    { channelId, messageId, url, action, emoji: emojiInput },
    context
  ) => {
    const ctx = channelContext(context?.requestContext);
    const target = parseSlackId(url ?? messageId ?? ctx.messageId, {
      channel: channelId ?? ctx.channelId,
    });
    if (!target.channel) {
      throw new Error('No channel available for react.');
    }
    if (!target.ts) {
      throw new Error('Pass messageId or url.');
    }
    // Only the triggering message and the thread root are known to sit in the
    // current thread without another Slack call, so any other message fails
    // closed.
    const current = parseSlackId(ctx.messageId, { channel: ctx.channelId });
    const isTriggeringMessage =
      target.channel === current.channel && target.ts === current.ts;
    if (
      !canPostDirect({
        targetThreadId: isTriggeringMessage ? ctx.threadId : threadIdOf(target),
        targetChannelId: target.channel,
        currentThreadId: ctx.threadId,
        ownerDmChannelId: await ownerDmChannelId(),
      })
    ) {
      throw new Error(
        "Reactions are only allowed in the current thread or the owner's own DM."
      );
    }

    const emoji = emojiInput.replaceAll(':', '');
    const request = {
      channel: target.channel,
      name: emoji,
      timestamp: target.ts,
    };
    if (action === 'remove') {
      await slack.webClient.reactions.remove(request);
      await auditSend({ kind: 'reaction', action, ...request });
      return {
        action,
        channelId: chatChannelId(target.channel),
        messageId: target.ts,
        emoji,
      };
    }

    await slack.webClient.reactions.add(request);
    await auditSend({ kind: 'reaction', action, ...request });
    return {
      action,
      channelId: chatChannelId(target.channel),
      messageId: target.ts,
      emoji,
    };
  },
});
