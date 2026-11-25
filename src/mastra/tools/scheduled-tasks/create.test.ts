import { expect, test } from 'bun:test';
import { createScheduledTaskTool } from './create';

test('creating a schedule waits for the owner to approve it', () => {
  expect(createScheduledTaskTool.requireApproval).toBe(true);
});
