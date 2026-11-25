import { z } from 'zod';
import { isOwner } from '../../lib/owner';

export const canvasIdSchema = z
  .string()
  .regex(
    /^F[A-Z0-9]+$/,
    'Must be a bare Slack file id (e.g. F0123ABCD), not a URL or permalink.'
  )
  .describe('Slack canvas id, e.g. F0123ABCD.');

function decodeCodePoint({
  match,
  code,
}: {
  match: string;
  code: number;
}): string {
  return code <= 0x10_ff_ff ? String.fromCodePoint(code) : match;
}

// A canvas mention notifies the person mentioned, which would start a
// conversation with them without an approval card. Slack's canvas parser is
// not documented, so rather than chase markdown spellings this decodes every
// way to write `@` (NFKC, entities, backslash escapes, percent-encoding, any
// depth) and then judges every `@<user id>` token anywhere in the text, plus
// every mention-shaped `@` (link destination or `<@`), whatever follows it.
// Over-blocking is the accepted cost.
export function assertNoThirdPartyMentions(markdown: string): void {
  let text = markdown;
  let previous: string | undefined;
  while (text !== previous) {
    previous = text;
    text = text
      .normalize('NFKC')
      .replace(/&#x0*([0-9a-f]+);/gi, (match, hex: string) =>
        decodeCodePoint({ match, code: Number.parseInt(hex, 16) })
      )
      .replace(/&#0*(\d+);/g, (match, decimal: string) =>
        decodeCodePoint({ match, code: Number.parseInt(decimal, 10) })
      )
      .replace(/&commat;/gi, '@')
      .replace(/\+(?=@)/g, '')
      .replace(/%40/gi, '@')
      .replace(/%25/gi, '%');
  }
  const ids = [
    ...[...text.matchAll(/@([UW][A-Z0-9]{4,})/gi)].map(([, id]) => id),
    ...[...text.matchAll(/(?:\]\(|<)\s*<?\s*@([^\s>|)"']*)/g)].map(
      ([, id]) => id
    ),
  ];
  if (ids.some((id) => !isOwner(id))) {
    throw new Error(
      'Canvas markdown cannot mention anyone but the owner, because a mention notifies that person. Write their name as plain text instead.'
    );
  }
}
