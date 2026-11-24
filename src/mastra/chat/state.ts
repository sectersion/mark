import type { Thread } from 'chat';
import { z } from 'zod';
import { isTainted } from '../lib/owner';
import type { ThreadState } from '../types';

const threadStateSchema = z.looseObject({
  lastSeenMessage: z.string().optional(),
  respondOnThreadMessages: z.boolean().optional(),
  tainted: z.boolean().optional(),
});

export async function threadState(
  thread: Pick<Thread, 'state'> | undefined
): Promise<ThreadState | null> {
  const state = await thread?.state;
  return state ? threadStateSchema.parse(state) : null;
}

export async function taintThread({
  thread,
  authorIds,
}: {
  thread: Pick<Thread, 'isDM' | 'state' | 'setState'>;
  authorIds: readonly (string | undefined)[];
}): Promise<boolean> {
  if (thread.isDM) {
    return false;
  }
  if ((await threadState(thread))?.tainted) {
    return true;
  }
  if (!isTainted(authorIds)) {
    return false;
  }
  await thread.setState({ tainted: true });
  return true;
}
