import { expect, test } from 'bun:test';
import { isOwner, isTainted } from './owner';

test('isOwner matches only the configured id', () => {
  expect(isOwner('UOWNER')).toBe(true);
  expect(isOwner('UOTHER')).toBe(false);
  expect(isOwner('uowner')).toBe(false);
});

test('isOwner is false when there is no user', () => {
  expect(isOwner(undefined)).toBe(false);
  expect(isOwner('')).toBe(false);
});

test('isTainted is true if any author is not the owner or is missing', () => {
  expect(isTainted(['UOWNER', 'UOWNER'])).toBe(false);
  expect(isTainted(['UOWNER', 'UOTHER'])).toBe(true);
  expect(isTainted(['UOWNER', undefined])).toBe(true);
  expect(isTainted([])).toBe(false);
});
