import { type ActionEvent, Actions, Button, Card, CardText } from 'chat';
import { z } from 'zod';
import { env } from '@/env';
import {
  expireApprovals,
  resolveApproval,
  setApprovalCard,
} from '../db/queries/approvals';
import { logger } from '../lib/logger';
import type {
  Approval,
  ApprovalDecision,
  ApprovalKind,
  ResolveApprovalResult,
} from '../types';
import { slack } from './client';
import { chat } from './instance';

const actionIds = {
  approve: 'approval_approve',
  decline: 'approval_decline',
} as const;

const buttonSchema = z.object({
  actionId: z.enum([actionIds.approve, actionIds.decline]),
  value: z.uuid(),
});

const cardMessageSchema = z.object({
  message: z.object({ blocks: z.array(z.looseObject({ type: z.string() })) }),
});

const cardTitles: Record<ApprovalKind, string> = {
  request: 'someone is asking for you',
  standing_rule: 'new standing rule?',
  outbound_message: 'ok to send this?',
};

const staleReplies = {
  already_resolved: 'that one was already decided, nothing changed',
  expired: 'that one expired, nothing changed',
  not_found: "couldn't find that request",
};

export function escapeMrkdwn(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function buttonDecision({
  actionId,
  value,
}: {
  actionId: string;
  value: string | undefined;
}): { id: string; decision: ApprovalDecision } | undefined {
  const parsed = buttonSchema.safeParse({ actionId, value });
  if (!parsed.success) {
    return;
  }
  return {
    id: parsed.data.value,
    decision:
      parsed.data.actionId === actionIds.approve ? 'approved' : 'declined',
  };
}

export function expiredByPress(
  outcome: ResolveApprovalResult
): Approval | undefined {
  return outcome.result === 'expired' ? outcome.approval : undefined;
}

export async function postApprovalCard({
  approval,
  text,
}: {
  approval: Approval;
  text: string;
}): Promise<void> {
  const dm = await chat().openDM(env.OWNER_SLACK_USER_ID);
  const sent = await dm.post(
    Card({
      title: cardTitles[approval.kind],
      children: [
        CardText(escapeMrkdwn(text)),
        ...(approval.requesterId
          ? [CardText(`from <@${approval.requesterId}>`, { style: 'muted' })]
          : []),
        Actions([
          Button({
            id: actionIds.approve,
            label: 'Approve',
            style: 'primary',
            value: approval.id,
          }),
          Button({
            id: actionIds.decline,
            label: 'Decline',
            style: 'danger',
            value: approval.id,
          }),
        ]),
      ],
    })
  );
  await setApprovalCard({
    id: approval.id,
    channel: slack.decodeThreadId(sent.threadId).channel,
    ts: sent.id,
  });
}

export function registerApprovals(): void {
  chat().onAction([actionIds.approve, actionIds.decline], onApprovalClick);
}

async function onApprovalClick(event: ActionEvent): Promise<void> {
  const button = buttonDecision({
    actionId: event.actionId,
    value: event.value,
  });
  if (!button) {
    logger.warn('[approvals] malformed button', { value: event.value });
    return;
  }
  const outcome = await resolveApproval({
    id: button.id,
    decision: button.decision,
    deciderId: event.user.userId,
  });
  if (outcome.result === 'forbidden') {
    return;
  }
  if (outcome.result !== 'ok') {
    try {
      await event.thread?.postEphemeral(
        event.user,
        staleReplies[outcome.result],
        { fallbackToDM: true }
      );
    } catch (error) {
      logger.warn('[approvals] stale reply failed', { error });
    }
    const expired = expiredByPress(outcome);
    if (expired) {
      await tellExpired(expired);
    }
    return;
  }
  const label =
    button.decision === 'approved'
      ? ':white_check_mark: approved'
      : ':x: declined';
  const blocks = cardMessageSchema.safeParse(event.raw).data?.message.blocks;
  await slack.webClient.chat
    .update({
      channel: slack.decodeThreadId(event.threadId).channel,
      ts: event.messageId,
      text: label,
      blocks: [
        ...(blocks ?? []).filter((block) => block.type !== 'actions'),
        { type: 'context', elements: [{ type: 'mrkdwn', text: label }] },
      ],
    })
    .catch((error: unknown) =>
      logger.warn('[approvals] card update failed', { error, id: button.id })
    );
  await applyDecision(outcome.approval);
}

async function applyDecision(approval: Approval): Promise<void> {
  switch (approval.kind) {
    case 'request':
      await tellRequester({
        replyThread: approval.replyThread,
        text:
          approval.status === 'approved'
            ? 'they said yes'
            : "they can't right now",
      });
      return;
    case 'standing_rule':
      return;
    case 'outbound_message':
      // Sending the approved message is not wired up yet, so approving one
      // only records the decision.
      return;
    default: {
      const unhandled: never = approval;
      logger.error('[approvals] no effect for this kind', { unhandled });
    }
  }
}

async function tellRequester({
  replyThread,
  text,
}: {
  replyThread: string | null;
  text: string;
}): Promise<void> {
  if (!replyThread) {
    return;
  }
  await chat()
    .thread(replyThread)
    .post(text)
    .catch((error: unknown) =>
      logger.warn('[approvals] could not tell the requester', {
        error,
        replyThread,
      })
    );
}

async function tellExpired(approval: Approval): Promise<void> {
  if (approval.kind !== 'request') {
    return;
  }
  await tellRequester({
    replyThread: approval.replyThread,
    text: "didn't hear back, sorry",
  });
}

export async function sweepApprovals(): Promise<void> {
  try {
    const expired = await expireApprovals({ now: new Date() });
    await Promise.all(expired.map(tellExpired));
  } catch (error) {
    logger.error('[approvals] expiry sweep failed', { error });
  }
}
