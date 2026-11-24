import { expect, test } from 'bun:test';
import { proposeRuleTool } from './propose-rule';

const accepts = async (input: unknown) => {
  const result =
    await proposeRuleTool.inputSchema?.['~standard'].validate(input);
  return result !== undefined && !result.issues;
};

test('propose_rule accepts a rule of 1 to 300 characters', async () => {
  expect(await accepts({ rule: 'always reply in lowercase' })).toBe(true);
  expect(await accepts({ rule: 'x' })).toBe(true);
  expect(await accepts({ rule: 'x'.repeat(300) })).toBe(true);
});

test('propose_rule rejects an empty, too long, or non-string rule', async () => {
  expect(await accepts({ rule: '' })).toBe(false);
  expect(await accepts({ rule: 'x'.repeat(301) })).toBe(false);
  expect(await accepts({ rule: 42 })).toBe(false);
  expect(await accepts({})).toBe(false);
});

test('propose_rule rejects extra keys', async () => {
  expect(
    await accepts({ rule: 'always reply in lowercase', active: true })
  ).toBe(false);
});
