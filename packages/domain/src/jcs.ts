/**
 * Minimal RFC 8785 JSON Canonicalization Scheme (JCS) for fingerprinting.
 * Spec §32.1 — domain-only, no external deps.
 */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Escape a string per JSON / JCS (UTF-16 code units, no unnecessary escapes). */
function escapeString(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    switch (c) {
      case 0x08:
        out += '\\b';
        break;
      case 0x09:
        out += '\\t';
        break;
      case 0x0a:
        out += '\\n';
        break;
      case 0x0c:
        out += '\\f';
        break;
      case 0x0d:
        out += '\\r';
        break;
      case 0x22:
        out += '\\"';
        break;
      case 0x5c:
        out += '\\\\';
        break;
      default:
        if (c < 0x20) {
          out += `\\u${c.toString(16).padStart(4, '0')}`;
        } else {
          out += s[i];
        }
    }
  }
  return `${out}"`;
}

/**
 * Serialize a finite number as ECMAScript / JCS would (JSON.stringify of Number).
 * Rejects NaN / ±Infinity — callers must not include non-finite numbers in fingerprints.
 */
function serializeNumber(n: number): string {
  if (!Number.isFinite(n)) {
    throw new Error('JCS fingerprint payload must not contain non-finite numbers');
  }
  // JSON.stringify already matches JCS number formatting for finite JS numbers.
  return JSON.stringify(n);
}

/** Canonicalize any JSON-compatible value per RFC 8785. */
export function canonicalizeJcs(value: unknown): string {
  if (value === null) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (typeof value === 'string') return escapeString(value);
  if (typeof value === 'number') return serializeNumber(value);
  if (typeof value === 'bigint') {
    throw new Error('JCS does not support bigint');
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalizeJcs(v)).join(',')}]`;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const parts: string[] = [];
    for (const k of keys) {
      const v = value[k];
      if (v === undefined) continue; // omit undefined (not valid JSON)
      parts.push(`${escapeString(k)}:${canonicalizeJcs(v)}`);
    }
    return `{${parts.join(',')}}`;
  }
  throw new Error(`JCS cannot canonicalize type ${typeof value}`);
}
