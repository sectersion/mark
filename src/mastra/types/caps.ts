export type CapName = 'ownerTurns' | 'receptionistReplies';

export type CapDecision =
  | { status: 'ok' }
  | { status: 'exceeded'; cap: CapName; count: number; limit: number };
