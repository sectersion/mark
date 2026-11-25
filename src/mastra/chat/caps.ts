import { env } from '@/env';
import { countAuditByAction, writeAudit } from '../db/queries/audit';
import { capDecision, startOfLocalDay } from '../lib/caps';
import { logger } from '../lib/logger';
import { chat } from './instance';

const labels = {
  ownerTurns: 'owner turns',
  receptionistReplies: 'receptionist replies',
};

export async function enforceDailyCaps(): Promise<boolean> {
  try {
    const counts = await countAuditByAction({
      actions: ['turn', 'receptionist.reply', 'cap.exceeded'],
      since: startOfLocalDay({ now: new Date() }),
    });
    if ((counts.get('cap.exceeded') ?? 0) > 0) {
      return true;
    }
    const decision = capDecision({
      counts: {
        ownerTurns: counts.get('turn') ?? 0,
        receptionistReplies: counts.get('receptionist.reply') ?? 0,
      },
    });
    if (decision.status === 'ok') {
      return false;
    }
    await writeAudit({
      actor: 'system',
      action: 'cap.exceeded',
      detail: {
        cap: decision.cap,
        count: decision.count,
        limit: decision.limit,
      },
    });
    await chat()
      .openDM(env.OWNER_SLACK_USER_ID)
      .then((dm) =>
        dm.post(
          `hit the daily cap on ${labels[decision.cap]} (${decision.count} of ${decision.limit}). strangers get "mark is offline" until midnight Chicago time; you are not blocked.`
        )
      )
      .catch((error: unknown) =>
        logger.error('[caps] could not DM the owner', { error })
      );
    return true;
  } catch (error) {
    logger.error('[caps] cap check failed', { error });
    return false;
  }
}
