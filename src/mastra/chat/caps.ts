import { env } from '@/env';
import { countAuditByAction, writeAudit } from '../db/queries/audit';
import { capDecision, startOfLocalDay } from '../lib/caps';
import { logger } from '../lib/logger';
import { isPaused, setPaused } from '../lib/pause';
import { chat } from './instance';

const labels = {
  ownerTurns: 'owner turns',
  receptionistReplies: 'receptionist replies',
};

export async function enforceDailyCaps(): Promise<boolean> {
  try {
    const counts = await countAuditByAction({
      actions: ['turn', 'receptionist.reply'],
      since: startOfLocalDay({ now: new Date() }),
    });
    const decision = capDecision({
      counts: {
        ownerTurns: counts.get('turn') ?? 0,
        receptionistReplies: counts.get('receptionist.reply') ?? 0,
      },
    });
    if (decision.status === 'ok') {
      return false;
    }
    if (await isPaused()) {
      return true;
    }
    await setPaused({ paused: true, byId: env.OWNER_SLACK_USER_ID });
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
          `paused: hit the daily cap on ${labels[decision.cap]} (${decision.count} of ${decision.limit}). resume when you want me back, but the cap still applies until local midnight.`
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
