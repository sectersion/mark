import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { postApprovalCard } from '../../chat/approvals';
import { approval } from '../../config';
import { createApproval } from '../../db/queries/approvals';
import { channelContext } from '../../lib/context';
import { approvalPayloadSchemas } from '../../types';
import { input, output } from '../../types/tools/index';

export const passToOwnerTurnKey = 'passToOwnerTurn';

export const passToOwnerTool = createTool({
  id: 'pass_to_owner',
  description:
    'Pass a short message from the person you are talking to along to the owner. Call it once per request.',
  inputSchema: input({
    summary: approvalPayloadSchemas.request.shape.summary.describe(
      'One or two neutral sentences saying what the person wants.'
    ),
    wantsReply: z
      .boolean()
      .describe('Whether the person wants an answer back.'),
  }),
  outputSchema: output({ result: z.string() }),
  execute: async ({ summary, wantsReply }, context) => {
    // Parallel calls from one model step all start in the same JS turn, so
    // flipping this before the first await lets exactly one through. It is an
    // object, not a boolean key, because Mastra may hand each tool call a
    // shallow copy of the request context.
    const turn = context.requestContext?.get(passToOwnerTurnKey);
    if (typeof turn === 'object' && turn !== null && 'passed' in turn) {
      if (turn.passed) {
        return { result: 'passed along' };
      }
      turn.passed = true;
    }
    const { userId, threadId } = channelContext(context.requestContext);
    const created = await createApproval({
      kind: 'request',
      payload: { summary, wantsReply },
      requesterId: userId,
      replyThread: threadId,
      ttlMs: approval.ttl,
    });
    await postApprovalCard({ approval: created, text: summary });
    return { result: 'passed along' };
  },
});
