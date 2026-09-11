#!/usr/bin/env node
/**
 * Generate simple solid-color PNG fixtures for eval SKUs (no real product photos).
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'eval-products');
const skus = ['SKU-SYN-001', 'SKU-SYN-002', 'SKU-SYN-003'];
const colors = [
  { r: 240, g: 240, b: 240 },
  { r: 220, g: 235, b: 250 },
  { r: 250, g: 230, b: 220 },
];

for (let i = 0; i < skus.length; i++) {
  const sku = skus[i];
  const dir = join(root, sku, 'images');
  mkdirSync(dir, { recursive: true });
  const png = await sharp({
    create: { width: 512, height: 512, channels: 3, background: colors[i] },
  })
    .png()
    .toBuffer();
  writeFileSync(join(dir, 'front.png'), png);
  const meta = JSON.parse(readFileSync(join(root, sku, 'product.json'), 'utf8'));
  writeFileSync(
    join(dir, 'README.txt'),
    `Synthetic placeholder for ${meta.sku} — not a real product photo.\n`,
  );
  console.log('wrote', join(dir, 'front.png'));
}
