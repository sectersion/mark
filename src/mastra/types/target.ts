import { z } from 'zod';

export const targetSchema = z.object({
  type: z.enum(['thread', 'channel', 'user']).describe('Target kind.'),
  // Approval cards render the id as a live Slack mention, so it must be a bare
  // Slack id with nothing that could close the mention or start another.
  id: z
    .string()
    .max(64)
    .regex(/^(slack:)?[UWCDG][A-Z0-9]+(:(\d{10}\.\d{6})?)?$/)
    .describe(
      'Chat SDK id: thread (slack:<conversation-id>:ts), conversation (slack:C..., slack:D..., or slack:G...), or a user id.'
    ),
});

export type Target = z.infer<typeof targetSchema>;
