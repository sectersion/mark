export function isTestDatabaseUrl(url: string): boolean {
  try {
    return decodeURIComponent(new URL(url).pathname.slice(1)).endsWith('_test');
  } catch {
    return false;
  }
}
