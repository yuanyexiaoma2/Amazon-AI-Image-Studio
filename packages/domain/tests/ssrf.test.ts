import { describe, expect, it } from 'vitest';
import {
  assertNoExternalFetchUrl,
  isPrivateOrLocalHostname,
  refuseExternalFetchUrl,
} from '../src/ssrf.js';

describe('W8-04 SSRF refusal', () => {
  it('allows relative storage keys', () => {
    expect(refuseExternalFetchUrl('workspaces/w/projects/p/assets/a/original/v.png').ok).toBe(true);
  });

  it('refuses http(s) remote fetches', () => {
    const r = refuseExternalFetchUrl('https://evil.example/steal');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('SSRF_REFUSED');
  });

  it('refuses localhost / metadata / private IPs', () => {
    expect(isPrivateOrLocalHostname('127.0.0.1')).toBe(true);
    expect(isPrivateOrLocalHostname('10.0.0.5')).toBe(true);
    expect(isPrivateOrLocalHostname('192.168.1.1')).toBe(true);
    expect(isPrivateOrLocalHostname('169.254.169.254')).toBe(true);
    expect(isPrivateOrLocalHostname('metadata.google.internal')).toBe(true);
    expect(refuseExternalFetchUrl('http://127.0.0.1/latest/meta-data').ok).toBe(false);
    expect(refuseExternalFetchUrl('http://169.254.169.254/latest/meta-data').ok).toBe(false);
  });

  it('refuses file:// and path traversal', () => {
    expect(refuseExternalFetchUrl('file:///etc/passwd').ok).toBe(false);
    expect(refuseExternalFetchUrl('../etc/passwd').ok).toBe(false);
    expect(refuseExternalFetchUrl('/var/run/secrets').ok).toBe(false);
  });

  it('assert throws on SSRF', () => {
    expect(() => assertNoExternalFetchUrl('https://example.com/x')).toThrow(/SSRF_REFUSED/);
  });
});
