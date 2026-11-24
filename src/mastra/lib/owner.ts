import { env } from '@/env';

export function isOwner(userId: string | undefined): boolean {
  return userId !== undefined && userId === env.OWNER_SLACK_USER_ID;
}

export function isTainted(authorIds: readonly (string | undefined)[]): boolean {
  return authorIds.some((id) => !isOwner(id));
}
