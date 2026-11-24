import { expect, test } from 'bun:test';
import { routeMessage } from './route';

test.each([
  [{ authorId: 'UOWNER', tainted: false, paused: false }, 'mark'],
  [{ authorId: 'UOWNER', tainted: false, paused: true }, 'mark'],
  [{ authorId: 'UOWNER', tainted: true, paused: false }, 'receptionist'],
  [{ authorId: 'UOWNER', tainted: true, paused: true }, 'receptionist'],
  [{ authorId: 'UOTHER', tainted: false, paused: false }, 'receptionist'],
  [{ authorId: 'UOTHER', tainted: true, paused: false }, 'receptionist'],
  [{ authorId: 'UOTHER', tainted: false, paused: true }, 'offline'],
  [{ authorId: undefined, tainted: false, paused: false }, 'receptionist'],
  [{ authorId: undefined, tainted: true, paused: false }, 'receptionist'],
  [{ authorId: undefined, tainted: false, paused: true }, 'offline'],
  [{ authorId: '', tainted: false, paused: false }, 'receptionist'],
])('routes %j to %s', (args, expected) => {
  expect<string>(routeMessage(args)).toBe(expected);
});
