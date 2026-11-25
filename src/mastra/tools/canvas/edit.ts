import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { slack } from '../../chat/client';
import { auditSend } from '../../lib/audit-send';
import { channelContext } from '../../lib/context';
import { input, output } from '../../types/tools/index';
import { canPostDirect, ownerDmChannelId } from '../slack/utils';
import { assertNoThirdPartyMentions, canvasIdSchema } from './utils';

const markdownContentSchema = z.object({
  type: z.literal('markdown').default('markdown'),
  markdown: z
    .string()
    .min(1)
    .describe('Markdown canvas content, with no mentions of people.'),
});

const canvasChangeSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('insert_after'),
    section_id: z.string().min(1),
    document_content: markdownContentSchema,
  }),
  z.object({
    operation: z.literal('insert_before'),
    section_id: z.string().min(1),
    document_content: markdownContentSchema,
  }),
  z.object({
    operation: z.literal('insert_at_start'),
    document_content: markdownContentSchema,
  }),
  z.object({
    operation: z.literal('insert_at_end'),
    document_content: markdownContentSchema,
  }),
  z.object({
    operation: z.literal('replace'),
    section_id: z.string().min(1).optional(),
    document_content: markdownContentSchema,
  }),
  z.object({
    operation: z.literal('delete'),
    section_id: z.string().min(1),
  }),
]);

export const editCanvasTool = createTool({
  id: 'edit_canvas',
  description:
    "Edit a Slack canvas by applying ordered markdown changes: insert, replace, or delete sections. Only canvases shared in the owner's own DM, and nowhere else, can be edited. Use lookup_canvas_sections to find section ids first. Do not mention people in canvas markdown: a mention notifies them, so one of anyone but the owner is refused.",
  inputSchema: input({
    canvasId: canvasIdSchema,
    changes: z.tuple([canvasChangeSchema]).rest(canvasChangeSchema),
  }),
  outputSchema: output({ canvasId: z.string() }),
  transform: {
    display: {
      output: ({ output }) => ({
        summary: `Edited canvas ${output?.canvasId ?? ''}`,
      }),
    },
  },
  execute: async ({ canvasId, changes }, context) => {
    for (const change of changes) {
      if ('document_content' in change) {
        assertNoThirdPartyMentions(change.document_content.markdown);
      }
    }
    const info = await slack.webClient.files.info({ file: canvasId });
    const ctx = channelContext(context.requestContext);
    const ownerDm = await ownerDmChannelId();
    const sharedIn = [
      ...(info.file?.channels ?? []),
      ...(info.file?.groups ?? []),
      ...(info.file?.ims ?? []),
    ];
    // An edit is visible to everyone the canvas is shared with and cannot wait
    // on the owner's approval, so only a canvas shared in the owner's own DM
    // alone is editable.
    if (
      sharedIn.length === 0 ||
      !sharedIn.every((channelId) =>
        canPostDirect({
          targetThreadId: undefined,
          targetChannelId: channelId,
          currentThreadId: ctx.threadId,
          ownerDmChannelId: ownerDm,
        })
      )
    ) {
      throw new Error(
        "Only canvases shared in the owner's own DM, and nowhere else, can be edited."
      );
    }
    try {
      await slack.webClient.canvases.edit({
        canvas_id: canvasId,
        changes,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (reason.includes('restricted_action')) {
        throw new Error(
          `Can't edit canvas ${canvasId}: only read access, not write. This canvas's sharing settings need to grant the bot write access (its owner can do this from the canvas's "Manage access" menu in Slack), the canvases:write scope alone isn't enough.`,
          { cause: error }
        );
      }
      throw error;
    }
    await auditSend({ detail: { kind: 'canvas_edit', canvasId } });
    return { canvasId };
  },
});
