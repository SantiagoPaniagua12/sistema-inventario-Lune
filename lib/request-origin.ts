/** Next can reconstruct request.url with localhost even when Host is 127.0.0.1. */
export function isAllowedInventoryOrigin(request: Request): boolean {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    if (process.env.NODE_ENV === 'production') {
      const configured = process.env.APP_ORIGIN;
      if (!configured || new URL(configured).protocol !== 'https:') return false;
      return origin === new URL(configured).origin && configured === origin;
    }
    const internal = new URL(request.url);
    const rawHost = request.headers.get('host') ?? internal.host;
    const external = new URL(`${internal.protocol}//${rawHost}`);
    // This beta listens on loopback only. Never trust arbitrary forwarded hosts.
    if (!['localhost', '127.0.0.1', '[::1]'].includes(external.hostname)) return false;
    if (external.port !== internal.port || external.username || external.password || external.pathname !== '/' || external.search || external.hash) return false;
    const source = new URL(origin);
    return source.origin === origin && source.origin === external.origin;
  } catch { return false; }
}
