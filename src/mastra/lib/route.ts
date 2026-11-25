import { isOwner } from './owner';

export function routeMessage({
  authorId,
  tainted,
  paused,
}: {
  authorId: string | undefined;
  tainted: boolean;
  paused: boolean;
}): 'mark' | 'receptionist' | 'offline' {
  if (!isOwner(authorId)) {
    return paused ? 'offline' : 'receptionist';
  }
  if (!tainted) {
    return 'mark';
  }
  // Pause turns the receptionist off for everyone, the owner included.
  return paused ? 'offline' : 'receptionist';
}
