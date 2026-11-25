import { writeAudit } from '../db/queries/audit';
import { logger } from './logger';

export async function auditSend({
  detail,
  action = 'post',
}: {
  detail: Record<string, unknown>;
  action?: string;
}) {
  try {
    await writeAudit({ actor: 'mark', action, detail });
  } catch (error) {
    logger.error('[audit] could not record an outbound send', {
      error,
      action,
      detail,
    });
  }
}
