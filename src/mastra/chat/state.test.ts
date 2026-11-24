import { expect, test } from 'bun:test';
import { taintThread } from './state';

function fakeThread(isDM = false) {
  let stored: Record<string, unknown> | null = null;
  return {
    isDM,
    get state() {
      return Promise.resolve(stored);
    },
    setState: (next: Record<string, unknown>) => {
      stored = { ...stored, ...next };
      return Promise.resolve();
    },
    stored: () => stored,
  };
}

test('an owner-only turn leaves the thread untainted', async () => {
  const thread = fakeThread();
  expect(await taintThread({ thread, authorIds: ['UOWNER'] })).toBe(false);
  expect(thread.stored()).toBeNull();
});

test('a stranger taints the thread for every later turn', async () => {
  const thread = fakeThread();
  expect(await taintThread({ thread, authorIds: ['UOWNER', 'UOTHER'] })).toBe(
    true
  );
  expect(thread.stored()).toEqual({ tainted: true });
  expect(await taintThread({ thread, authorIds: ['UOWNER'] })).toBe(true);
});

test('a missing author taints the thread', async () => {
  const thread = fakeThread();
  expect(await taintThread({ thread, authorIds: [undefined] })).toBe(true);
});

test('a DM is never tainted', async () => {
  const thread = fakeThread(true);
  expect(await taintThread({ thread, authorIds: ['UOTHER'] })).toBe(false);
  expect(thread.stored()).toBeNull();
});
