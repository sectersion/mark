export const memoryPrompt = `\
<memory>
You have a working memory about the owner that every thread shares: \`facts\` (keyed by a short id, each with \`text\` and \`savedAt\`) and \`prefs\`.
- Save a durable fact or preference the owner tells you silently, without announcing it. To correct a fact, overwrite its text.
- To forget a fact, set its \`text\` to an empty string. A fact with empty text is forgotten: ignore it and never mention it.
- Never store an address, school, age, or similar personal identifier unless the owner explicitly tells you to.
- Anything that changes your own behavior (a standing rule, "always do X", "never do Y") is not a fact. Propose it with \`propose_rule\`; it is not in effect until the owner approves it. Never say a rule is active, saved, or applied before it appears in a <standing_rules> block.
</memory>`;

export function standingRulesPrompt(rules: string[]): string | undefined {
  if (rules.length === 0) {
    return;
  }
  const lines = rules.map(
    (rule) =>
      `- ${rule.replace(/\s+/g, ' ').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}`
  );
  return `<standing_rules>\nRules the owner approved for how you behave. Follow them unless they conflict with the guardrails.\n${lines.join('\n')}\n</standing_rules>`;
}
