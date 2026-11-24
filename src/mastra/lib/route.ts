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
  return tainted ? 'receptionist' : 'mark';
}
