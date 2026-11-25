import { z } from 'zod';
import { isOwner } from '../../lib/owner';

export const canvasIdSchema = z
  .string()
  .regex(
    /^F[A-Z0-9]+$/,
    'Must be a bare Slack file id (e.g. F0123ABCD), not a URL or permalink.'
  )
  .describe('Slack canvas id, e.g. F0123ABCD.');

// A canvas mention notifies the person mentioned, which would start a
// conversation with them without an approval card. The pattern stops at the
// id rather than requiring `)`, so title and `<...>` destination spellings,
// and the raw `<@U...>` form, are caught too; an empty id fails closed.
export function assertNoThirdPartyMentions(markdown: string): void {
  for (const [, id] of markdown.matchAll(
    /(?:\]\(|<)\s*<?\s*@([A-Za-z0-9]*)/g
  )) {
    if (!isOwner(id)) {
      throw new Error(
        'Canvas markdown cannot mention anyone but the owner, because a mention notifies that person. Write their name as plain text instead.'
      );
    }
  }
}
