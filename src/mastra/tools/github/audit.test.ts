import { afterAll, expect, mock, spyOn, test } from 'bun:test';
import { tool } from 'ai';
import { z } from 'zod';
import { logger } from '../../lib/logger';

const realAudit = await import('../../db/queries/audit');
const realExports = { ...realAudit };

mock.module('../../db/queries/audit', () => ({
  ...realExports,
  writeAudit: () => Promise.reject(new Error('db down')),
}));

const { auditIfWrite } = await import('./audit');

afterAll(() => {
  mock.module('../../db/queries/audit', () => realExports);
});

const build = () => {
  const calls: unknown[] = [];
  const audit = (row: unknown) => {
    calls.push(row);
    return Promise.resolve();
  };
  const original = tool({
    inputSchema: z.object({}),
    execute: () => Promise.resolve('done'),
  });
  return { audit, calls, original };
};

const call = (wrapped: ReturnType<typeof auditIfWrite>) =>
  wrapped.execute?.(
    { owner: 'o', repo: 'r', issueNumber: 3, title: 'secret title' },
    { toolCallId: 'c', messages: [], context: {} }
  );

test('a write tool is audited once with ids only and returns the original result', async () => {
  const { audit, calls, original } = build();
  const wrapped = auditIfWrite({ name: 'createIssue', tool: original, audit });
  expect(await call(wrapped)).toBe('done');
  expect(calls).toEqual([
    {
      action: 'github_write',
      detail: {
        tool: 'createIssue',
        owner: 'o',
        repo: 'r',
        issueNumber: 3,
        pullNumber: undefined,
        commentId: undefined,
      },
    },
  ]);
});

test('a read tool is returned untouched and never audited', async () => {
  const { audit, calls, original } = build();
  const wrapped = auditIfWrite({
    name: 'getRepository',
    tool: original,
    audit,
  });
  expect(wrapped).toBe(original);
  expect(await call(wrapped)).toBe('done');
  expect(calls).toHaveLength(0);
});

test('an audit failure is logged and does not change the result', async () => {
  const logged = spyOn(logger, 'error').mockImplementation(() => undefined);
  const { original } = build();
  const wrapped = auditIfWrite({ name: 'createIssue', tool: original });
  expect(await call(wrapped)).toBe('done');
  expect(logged).toHaveBeenCalledTimes(1);
  logged.mockRestore();
});
