/**
 * Deterministic ZIP (STORE, no compression) with fixed DOS timestamps.
 * Spec §32.11: entry order fixed; times = bundle createdAt for stable checksums.
 */

import { crc32 } from 'node:zlib';

export type ZipStoreEntry = {
  path: string;
  bytes: Buffer;
};

function dosDateTime(d: Date): { time: number; date: number } {
  const year = d.getUTCFullYear();
  const clamped = Number.isFinite(year) ? Math.min(2107, Math.max(1980, year)) : 2026;
  const date = ((clamped - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2);
  return { time, date };
}

function u16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n >>> 0, 0);
  return b;
}

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

export function buildStoredZip(entries: ZipStoreEntry[], createdAt: Date): Buffer {
  const { time, date } = dosDateTime(createdAt);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8');
    const data = entry.bytes;
    const crc = crc32(data) >>> 0;
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0), // STORE
      u16(time),
      u16(date),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
      data,
    ]);
    locals.push(local);
    const central = Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(time),
      u16(date),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ]);
    centrals.push(central);
    offset += local.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralBuf.length),
    u32(offset),
    u16(0),
  ]);
  return Buffer.concat([...locals, centralBuf, eocd]);
}
