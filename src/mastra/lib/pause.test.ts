import { expect, test } from 'bun:test';
import { runMigrations } from '../db';
import { isPaused, setPaused } from './pause';

const noDb = !process.env.TEST_DB;

test('setPaused throws for a non-owner before touching the database', async () => {
  await expect(setPaused({ paused: true, byId: 'UOTHER' })).rejects.toThrow(
    'Only the owner'
  );
});

test.skipIf(noDb)('isPaused is false with no rows', async () => {
  await runMigrations();
  expect(await isPaused()).toBe(false);
});

test.skipIf(noDb)('paused after pause, running after resume', async () => {
  await runMigrations();
  await setPaused({ paused: true, byId: 'UOWNER' });
  expect(await isPaused()).toBe(true);
  await setPaused({ paused: false, byId: 'UOWNER' });
  expect(await isPaused()).toBe(false);
});
