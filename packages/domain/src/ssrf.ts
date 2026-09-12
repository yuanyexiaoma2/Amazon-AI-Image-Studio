/**
 * Upload / fetch SSRF refusal helpers (W8-04).
 * Studio never server-side fetches user-supplied URLs for assets;
 * this guard refuses any attempted remote URL ingestion.
 */

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.google',
  'instance-data',
]);

/** True if hostname is loopback, link-local, or RFC1918 private. */
export function isPrivateOrLocalHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (!host) return true;
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return true;
  }
  // IPv4 literals
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  }
  // IPv6 loopback / ULA / link-local (simplified)
  if (host === '::1' || host === '[::1]') return true;
  if (host.startsWith('fe80:') || host.startsWith('[fe80:')) return true;
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('[fc') || host.startsWith('[fd')) {
    return true;
  }
  return false;
}

export type RefuseExternalFetchResult =
  | { ok: true }
  | { ok: false; code: 'SSRF_REFUSED'; reason: string };

/**
 * Refuse any absolute URL that would cause the server to fetch a remote/private target.
 * Relative storage keys (workspaces/...) are allowed — those are not fetches.
 */
export function refuseExternalFetchUrl(raw: string | null | undefined): RefuseExternalFetchResult {
  if (raw == null || String(raw).trim() === '') {
    return { ok: false, code: 'SSRF_REFUSED', reason: 'Empty URL refused' };
  }
  const value = String(raw).trim();

  // Storage object keys are not URLs
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    if (value.includes('..') || value.startsWith('/')) {
      return { ok: false, code: 'SSRF_REFUSED', reason: 'Path traversal / absolute filesystem path refused' };
    }
    return { ok: true };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, code: 'SSRF_REFUSED', reason: 'Malformed URL refused' };
  }

  const protocol = url.protocol.toLowerCase();
  if (protocol !== 'https:' && protocol !== 'http:') {
    return { ok: false, code: 'SSRF_REFUSED', reason: `Protocol ${protocol} refused` };
  }
  if (isPrivateOrLocalHostname(url.hostname)) {
    return { ok: false, code: 'SSRF_REFUSED', reason: `Private/local host refused: ${url.hostname}` };
  }
  // Studio upload path never server-fetches user URLs — refuse all absolute http(s).
  return {
    ok: false,
    code: 'SSRF_REFUSED',
    reason: 'Server-side remote URL fetch is not supported (SSRF refusal)',
  };
}

/** Assert helper — throws Error with SSRF_REFUSED message. */
export function assertNoExternalFetchUrl(raw: string | null | undefined): void {
  const r = refuseExternalFetchUrl(raw);
  if (!r.ok) {
    throw new Error(`${r.code}: ${r.reason}`);
  }
}
