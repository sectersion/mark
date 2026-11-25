import { expect, test } from 'bun:test';
import { receptionist } from './receptionist';

test('the receptionist has exactly one tool, pass_to_owner', async () => {
  expect(Object.keys(await receptionist.listTools())).toEqual([
    'pass_to_owner',
  ]);
});
