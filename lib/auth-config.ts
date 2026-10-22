export function authConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  if (!key.startsWith('sb_publishable_')) {
    try { if (JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role !== 'anon') return null; }
    catch { return null; }
  }
  try { const parsed = new URL(url); if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.supabase.co') || parsed.username || parsed.password) return null; } catch { return null; }
  return { url, key };
}
export const authCookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/', maxAge: 8 * 60 * 60 };
