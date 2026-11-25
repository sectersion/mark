// Format characters (zero-width, soft hyphen, bidi controls), Unicode tag
// characters and control characters render as nothing on an approval card
// but still reach the model, so a card could hide text the owner approves.
const invisible = /[\p{Cf}\u{E0000}-\u{E007F}‪-‮⁦-⁩]|[^\P{Cc}\n\t]/gu;

export function stripInvisible(text: string): string {
  return text.replace(invisible, '');
}
