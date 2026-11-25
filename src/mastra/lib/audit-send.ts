import { writeAudit } from '../db/queries/audit';
import { logger } from './logger';

export async function auditSend(detail: Record<string, unknown>) {
  try {
    await writeAudit({ actor: 'mark', action: 'post', detail });
  } catch (error) {
    logger.error('[audit] could not record an outbound send', {
      error,
      detail,
    });
  }
}
