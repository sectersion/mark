const live = {
  HACKCLUB_API_KEY: process.env.HACKCLUB_API_KEY,
  AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY,
};

await import('./setup');

process.env.HACKCLUB_API_KEY = live.HACKCLUB_API_KEY ?? 'x';
process.env.AI_GATEWAY_API_KEY = live.AI_GATEWAY_API_KEY ?? 'x';
process.env.INJECTION_EVALS = '1';
