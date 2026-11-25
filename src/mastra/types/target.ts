import { z } from 'zod';

// Approval cards render the id as a live mention chosen by `type`, so the id
// must be a bare Slack id of that same kind. DM conversation ids (D...) are
// refused: Slack delivers a post there to a person, so a DM is always a `user`
// target and the card always shows that person.
const idPatterns = {
  user: /^[UW][A-Z0-9]+$/,
  channel: /^(slack:)?[CG][A-Z0-9]+$/,
  thread: /^slack:[CG][A-Z0-9]+:\d{10}\.\d{6}$/,
};

export const targetSchema = z
  .object({
    type: z.enum(['thread', 'channel', 'user']).describe('Target kind.'),
    id: z
      .string()
      .max(64)
      .describe(
        'user: a user id (U... or W...), also for any DM including the owner. channel: slack:C... or slack:G.... thread: slack:<C or G id>:<ts>. DM conversation ids (D...) are not accepted; use the user id instead.'
      ),
  })
  .refine(({ type, id }) => idPatterns[type].test(id), {
    message: 'The id is not a Slack id of that target type.',
    path: ['id'],
  });

export type Target = z.infer<typeof targetSchema>;
