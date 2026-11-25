import { server } from '../config';

const loopbackHosts = [`127.0.0.1:${server.port}`, `localhost:${server.port}`];

export const loopbackOrigins = loopbackHosts.map((host) => `http://${host}`);

// Binding to loopback does not stop the owner's own browser: any page can
// send it requests (CORS only hides the answer) or rebind its own hostname to
// 127.0.0.1. So the Host must be loopback, a browser Origin must be loopback,
// and production serves no API at all, because Slack arrives over Socket Mode.
export function isAllowedRequest({
  host,
  origin,
  path,
  production,
}: {
  host: string | undefined;
  origin: string | undefined;
  path: string;
  production: boolean;
}): boolean {
  if (production && (path === '/api' || path.startsWith('/api/'))) {
    return false;
  }
  if (host === undefined || !loopbackHosts.includes(host)) {
    return false;
  }
  return origin === undefined || loopbackOrigins.includes(origin);
}
