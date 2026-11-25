import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { slack } from '../../chat/client';
import { upload } from '../../config';
import { auditSend } from '../../lib/audit-send';
import { channelContext } from '../../lib/context';
import { parseSlackId, rawId } from '../../lib/ids';
import { type Target, targetSchema } from '../../types';
import { input, output } from '../../types/tools/index';
import { requireSandbox } from '../../workspace';
import { isDirectTarget, joinChannel } from './utils';

async function slackDestination(
  target: Target
): Promise<{ channel: string; threadTs: string | undefined }> {
  if (target.type === 'user') {
    const dm = await slack.webClient.conversations.open({
      users: rawId(target.id),
    });
    return { channel: dm.channel?.id ?? '', threadTs: undefined };
  }
  if (target.type === 'thread') {
    const { channel, ts } = parseSlackId(target.id);
    return { channel: channel ?? '', threadTs: ts };
  }
  return { channel: rawId(target.id), threadTs: undefined };
}

export const uploadFileTool = createTool({
  id: 'upload_file',
  description:
    "Upload a file from the sandbox to Slack. Defaults to the current thread. The only other allowed target is the owner's own DM; anything else is refused.",
  inputSchema: input({
    path: z
      .string()
      .min(1)
      .describe(
        'Path to the file in the sandbox (relative to the working dir).'
      ),
    filename: z
      .string()
      .optional()
      .describe('Optional filename shown in Slack.'),
    comment: z
      .string()
      .optional()
      .describe('Optional message to post alongside the file.'),
    target: targetSchema
      .optional()
      .describe("Optional destination: only the owner's own DM."),
  }),
  outputSchema: output({
    filename: z.string(),
    path: z.string(),
    fileId: z.string().optional(),
  }),
  transform: {
    display: {
      output: ({ output }) => ({
        summary: `Uploaded ${output?.filename ?? 'file'}`,
      }),
    },
  },
  execute: async ({ path, filename, comment, target }, context) => {
    if (!context?.requestContext) {
      throw new Error('No workspace context.');
    }
    const sandbox = await requireSandbox(context.requestContext);

    const stat = await sandbox.retryOnDead(() =>
      sandbox.e2b.files.getInfo(path)
    );
    if (stat.size > upload.maxBytes) {
      throw new Error(
        `${path} is ${Math.round(stat.size / 1_000_000)}MB, over the ${upload.maxBytes / 1_000_000}MB upload limit.`
      );
    }
    const name = filename ?? path.split('/').pop() ?? 'file';

    const ctx = channelContext(context.requestContext);
    const resolved =
      target ??
      (ctx.threadId
        ? { type: 'thread' as const, id: ctx.threadId }
        : undefined);
    if (!resolved) {
      throw new Error('No current thread to upload to.');
    }
    if (!(await isDirectTarget({ target: resolved, ctx }))) {
      throw new Error(
        "Files can only go to the current thread or the owner's own DM. A file cannot wait on the owner's approval, so it was not sent. Upload it here and let the owner forward it."
      );
    }
    if (resolved.type !== 'user') {
      await joinChannel({ channelId: resolved.id });
    }
    const destination = await slackDestination(resolved);

    const created = await slack.webClient.files.getUploadURLExternal({
      filename: name,
      length: stat.size,
    });
    if (!(created.upload_url && created.file_id)) {
      throw new Error('Slack did not return an upload URL.');
    }
    const source = await sandbox.retryOnDead(() =>
      // The read is drained at whatever rate Slack accepts bytes, and the idle
      // window defaults to the 60s request timeout, so a large file over a
      // slow link trips it partway through. 0 disables it.
      sandbox.e2b.files.read(path, {
        format: 'stream',
        streamIdleTimeoutMs: 0,
      })
    );
    let uploaded = 0;
    const body = source.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          uploaded += chunk.byteLength;
          controller.enqueue(chunk);
        },
      })
    );
    // `duplex: 'half'` is mandatory for a stream body on Node's undici and is
    // missing from the DOM `RequestInit` type. Bun tolerates its absence,
    // which is why this only failed once it ran under `mastra dev`.
    const streamed: RequestInit & { duplex: 'half' } = {
      body,
      duplex: 'half',
      method: 'POST',
    };
    const sent = await fetch(created.upload_url, streamed);
    if (!sent.ok) {
      throw new Error(`Upload to Slack failed with ${sent.status}.`);
    }
    // A stream E2B reclaims server-side ends cleanly rather than erroring, and
    // Slack accepts a body shorter than the length it was promised, so a
    // truncated file otherwise publishes looking intact. Check before
    // completing: an unfinished upload id expires on its own, a published
    // corrupt file does not.
    if (uploaded !== stat.size) {
      throw new Error(
        `${path} was truncated in transit: sent ${uploaded} of ${stat.size} bytes. Nothing was posted to Slack, try the upload again.`
      );
    }
    await slack.webClient.files.completeUploadExternal({
      channel_id: destination.channel,
      files: [{ id: created.file_id, title: name }],
      initial_comment: comment,
      thread_ts: destination.threadTs,
    });
    const fileId = created.file_id;
    await auditSend({ kind: 'file', target: resolved, fileId });

    return {
      filename: name,
      path,
      fileId,
    };
  },
});
