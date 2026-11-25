import { expect, test } from 'bun:test';
import { isTestDatabaseUrl } from './database';

test.each([
  ['postgres://localhost/mark_test', true],
  ['postgresql://u:p@db:5432/mark_test?schema=public', true],
  ['postgres://localhost/mark', false],
  ['postgres://localhost/mark_test_backup', false],
  ['postgres://localhost/', false],
  ['postgres://mark_test@localhost/mark', false],
  ['not a url', false],
])('%s is a test database: %p', (url, expected) => {
  expect(isTestDatabaseUrl(url)).toBe(expected);
});
