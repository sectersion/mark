import { z } from 'zod';

export const targetSchema = z.object({
  type: z.enum(['thread', 'channel', 'user']).describe('Target kind.'),
  id: z
    .string()
    .min(1)
    .describe(
      'Chat SDK id: thread (slack:<conversation-id>:ts), conversation (slack:C..., slack:D..., or slack:G...), or a user id.'
    ),
});

export type Target = z.infer<typeof targetSchema>;
