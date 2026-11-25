import { expect, test } from 'bun:test';
import { isAllowedRequest } from './loopback';

test.each([
  [
    'loopback ip in dev',
    '127.0.0.1:4111',
    undefined,
    '/api/agents',
    false,
    true,
  ],
  ['localhost in dev', 'localhost:4111', undefined, '/api/agents', false, true],
  [
    'studio calling from localhost',
    '127.0.0.1:4111',
    'http://localhost:4111',
    '/api/agents',
    false,
    true,
  ],
  [
    'a foreign origin',
    '127.0.0.1:4111',
    'https://evil.com',
    '/api/memory/threads',
    false,
    false,
  ],
  ['the null origin', '127.0.0.1:4111', 'null', '/api/agents', false, false],
  [
    'a loopback origin on another port',
    '127.0.0.1:4111',
    'http://127.0.0.1:3000',
    '/api/agents',
    false,
    false,
  ],
  ['a rebinding host', 'evil.com:4111', undefined, '/api/agents', false, false],
  ['a rebinding host without a port', 'evil.com', undefined, '/', false, false],
  [
    'a lookalike host',
    '127.0.0.1.evil.com:4111',
    undefined,
    '/api/agents',
    false,
    false,
  ],
  ['loopback on another port', '127.0.0.1:80', undefined, '/', false, false],
  ['a missing host', undefined, undefined, '/api/agents', false, false],
  [
    'any api call in production',
    '127.0.0.1:4111',
    undefined,
    '/api/agents',
    true,
    false,
  ],
  [
    'the api root in production',
    '127.0.0.1:4111',
    undefined,
    '/api',
    true,
    false,
  ],
  ['health in production', '127.0.0.1:4111', undefined, '/health', true, true],
])('%s', (_, host, origin, path, production, allowed) => {
  expect(isAllowedRequest({ host, origin, path, production })).toBe(allowed);
});
