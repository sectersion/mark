import { isTestDatabaseUrl } from './database';

process.env.SLACK_BOT_TOKEN = 'x';
process.env.SLACK_APP_TOKEN = 'x';
process.env.SLACK_USER_TOKEN = 'x';
process.env.HACKCLUB_API_KEY = 'x';
process.env.AI_GATEWAY_API_KEY = 'x';
process.env.DATABASE_URL ||= 'postgres://localhost/mark_test';
// DB tests write and delete rows, so never point them at the live database.
if (process.env.TEST_DB && !isTestDatabaseUrl(process.env.DATABASE_URL)) {
  throw new Error(
    'TEST_DB is set but DATABASE_URL does not name a database ending in _test. Point it at a throwaway test database.'
  );
}
process.env.LANGFUSE_PUBLIC_KEY = 'x';
process.env.LANGFUSE_SECRET_KEY = 'x';
process.env.E2B_API_KEY = 'x';
process.env.CREDENTIALS_KEY = Buffer.alloc(32, 1).toString('base64');
process.env.GITHUB_APP_SLUG = 'x';
process.env.GITHUB_APP_CLIENT_ID = 'x';
process.env.GITHUB_APP_CLIENT_SECRET = 'x';
process.env.EXA_API_KEY = 'x';
process.env.OWNER_SLACK_USER_ID = 'UOWNER';
