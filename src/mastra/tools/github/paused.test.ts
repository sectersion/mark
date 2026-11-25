import { afterAll, expect, mock, test } from 'bun:test';
import type { GitHubCredential } from '../../types';

const realGithub = await import('../../lib/github');
const realExports = { ...realGithub };

const credential: GitHubCredential = {
  expiresAt: undefined,
  kind: 'pat',
  login: 'me',
  refreshToken: undefined,
  scopes: [],
  token: 't',
};
let paused = true;

mock.module('../../lib/github', () => ({
  ...realExports,
  githubAccess: () =>
    Promise.resolve({
      state: 'connected',
      credential,
      direct: true,
      level: 'all',
      paused,
    }),
  githubAccessToken: () => Promise.resolve('t'),
}));

const { githubTools } = await import('./index');
const { ALLOWLIST, isWriteTool } = await import('./allowlist');

afterAll(() => {
  mock.module('../../lib/github', () => realExports);
});

test('paused keeps reads and checkout but drops writes and push', async () => {
  paused = true;
  const tools = await githubTools({
    channelId: 'C1',
    isDM: true,
    threadId: 't1',
    userId: 'UOWNER',
  });
  const ids = Object.keys(tools);
  expect(ids).toContain('github_get_repository');
  expect(ids).toContain('github_checkout');
  expect(ids).not.toContain('github_push_branch');
  expect(ids).not.toContain('github_create_issue');
  expect(ids).not.toContain('github_add_issue_comment');
  expect(ALLOWLIST.filter(isWriteTool).length).toBeGreaterThan(0);
});

test('not paused exposes writes and push', async () => {
  paused = false;
  const tools = await githubTools({
    channelId: 'C1',
    isDM: true,
    threadId: 't1',
    userId: 'UOWNER',
  });
  expect(Object.keys(tools)).toContain('github_push_branch');
  expect(Object.keys(tools)).toContain('github_create_issue');
});
