import { expect, test } from 'bun:test';
import { receptionist } from '../config';
import { allowReceptionist, trackedReceptionistUsers } from './rate-limit';

const { maxMessages, windowMs } = receptionist;

test('allows 10 messages in a window and blocks the 11th', () => {
  const now = 1_000_000;
  for (let i = 0; i < maxMessages; i++) {
    expect(allowReceptionist({ userId: 'UOTHER-a', now: now + i })).toBe(true);
  }
  expect(
    allowReceptionist({ userId: 'UOTHER-a', now: now + maxMessages })
  ).toBe(false);
});

test('allows again once the window has passed', () => {
  const now = 2_000_000;
  for (let i = 0; i < maxMessages; i++) {
    allowReceptionist({ userId: 'UOTHER-b', now });
  }
  expect(allowReceptionist({ userId: 'UOTHER-b', now: now + 1 })).toBe(false);
  expect(allowReceptionist({ userId: 'UOTHER-b', now: now + windowMs })).toBe(
    true
  );
});

test('users are limited independently', () => {
  const now = 3_000_000;
  for (let i = 0; i < maxMessages; i++) {
    allowReceptionist({ userId: 'UOTHER-c', now });
  }
  expect(allowReceptionist({ userId: 'UOTHER-c', now })).toBe(false);
  expect(allowReceptionist({ userId: 'UOTHER-d', now })).toBe(true);
});

test('forgets users whose window has passed', () => {
  // Later than any timestamp another test file in this process can have used.
  const now = Date.now() + 100 * windowMs;
  for (let i = 0; i < 50; i++) {
    allowReceptionist({ userId: `UOTHER-stale-${i}`, now });
  }
  allowReceptionist({ userId: 'UOTHER-fresh', now: now + windowMs });
  expect(trackedReceptionistUsers()).toBe(1);
});
