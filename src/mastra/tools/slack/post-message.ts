import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { postApprovalCard } from '../../chat/approvals';
import { approval } from '../../config';
import { createApproval } from '../../db/queries/approvals';
import { channelContext } from '../../lib/context';
import { approvalPayloadSchemas, targetSchema } from '../../types';
import { input, output } from '../../types/tools/index';
import { isDirectTarget, sendMessage } from './utils';

export const postMessageTool = createTool({
  id: 'post_message',
  description: `Send a markdown message to a different Slack thread, channel, or user.

Never use this to answer the current conversation, and never for status or progress updates in this thread: your normal assistant response, progress notes included, is already streamed here. Use this tool only when the user explicitly asks you to send something to a different thread, channel, or person (for example posting an update into another channel on their behalf).

Anything other than the current thread or the owner's own DM is not sent yet: it goes to the owner as an approval card and is posted exactly as written only if they approve. Tell the owner it is waiting on their approval; do not claim it was sent.

Every post automatically uses the requester's Slack avatar and labels the sender as "Name [gorkie]". Do not add that attribution yourself in the message text; there is no way to override or customize it.

Errors: channel_not_found usually means the bot isn't a member of that private channel; not_in_channel means it hasn't joined yet. Either way, tell the user to invite the bot there.`,
  inputSchema: input({
    target: targetSchema.describe(
      'Required destination outside the current conversation.'
    ),
    message: approvalPayloadSchemas.outbound_message.shape.text.describe(
      'Markdown message body.'
    ),
  }),
  outputSchema: output({
    result: z.string(),
    messageId: z.string().optional(),
    threadId: z.string().optional(),
  }),
  transform: {
    display: {
      output: ({ output }) => ({
        summary: output?.messageId
          ? `Posted message ${output.messageId}`
          : (output?.result ?? ''),
      }),
    },
  },
  execute: async ({ target, message }, context) => {
    const ctx = channelContext(context?.requestContext);
    if (!(await isDirectTarget({ target, ctx }))) {
      const created = await createApproval({
        kind: 'outbound_message',
        payload: { target, text: message },
        requesterId: ctx.userId,
        ttlMs: approval.ttl,
      });
      await postApprovalCard({
        approval: created,
        text: `to ${target.type} ${target.id}:\n${message}`,
      });
      return { result: "waiting on the owner's approval" };
    }
    try {
      return {
        result: 'sent',
        ...(await sendMessage({ target, markdown: message, ctx })),
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (reason.includes('channel_not_found')) {
        throw new Error(
          'Slack rejected the post with channel_not_found. For private channels this usually means the bot is not a member. Ask a member to invite the bot in that channel, then retry. If the channel is public, double-check the channel id.',
          { cause: error }
        );
      }
      if (reason.includes('not_in_channel')) {
        throw new Error(
          'Slack rejected the post with not_in_channel. Invite the bot to that channel, then retry.',
          { cause: error }
        );
      }
      throw error;
    }
  },
});
