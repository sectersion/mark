import type { GithubToolName } from '@github-tools/sdk';
import type { Tool } from 'ai';
import { z } from 'zod';
import { auditSend as defaultAudit } from '../../lib/audit-send';
import { isWriteTool } from './allowlist';

const identifiersSchema = z.looseObject({
  owner: z.string().optional(),
  repo: z.string().optional(),
  issueNumber: z.number().optional(),
  pullNumber: z.number().optional(),
  commentId: z.number().optional(),
});

export function auditIfWrite({
  name,
  tool,
  audit = defaultAudit,
}: {
  name: GithubToolName;
  tool: Tool;
  audit?: (params: {
    detail: Record<string, unknown>;
    action: string;
  }) => Promise<void>;
}): Tool {
  const { execute } = tool;
  if (!(isWriteTool(name) && execute)) {
    return tool;
  }
  return {
    ...tool,
    execute: async (input, options) => {
      const result = await execute(input, options);
      const { owner, repo, issueNumber, pullNumber, commentId } =
        identifiersSchema.safeParse(input).data ?? {};
      await audit({
        action: 'github_write',
        detail: { tool: name, owner, repo, issueNumber, pullNumber, commentId },
      });
      return result;
    },
  };
}
