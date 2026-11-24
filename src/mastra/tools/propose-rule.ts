import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { postApprovalCard } from '../chat/approvals';
import { approval } from '../config';
import { createApproval } from '../db/queries/approvals';
import { approvalPayloadSchemas } from '../types';
import { input, output } from '../types/tools/index';

export const proposeRuleTool = createTool({
  id: 'propose_rule',
  description:
    'Ask the owner to approve a standing rule that changes how you behave, such as "always do X" or "never do Y". The rule is not in effect until the owner approves it.',
  inputSchema: input({
    rule: approvalPayloadSchemas.standing_rule.shape.rule.describe(
      'The rule as one short instruction to yourself.'
    ),
  }),
  outputSchema: output({ result: z.string() }),
  execute: async ({ rule }) => {
    const created = await createApproval({
      kind: 'standing_rule',
      payload: { rule },
      ttlMs: approval.ruleTtl,
    });
    await postApprovalCard({ approval: created, text: rule });
    return {
      result: 'sent to the owner for approval, not in effect until approved',
    };
  },
});
