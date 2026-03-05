import sharp from 'sharp';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const svgPath = join(__dirname, '..', 'public', 'favicon.svg');
const outDir = join(__dirname, '..', 'public', 'icons');

const svg = readFileSync(svgPath);

const sizes = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'icon-maskable-192.png', size: 192, maskable: true },
  { name: 'icon-maskable-512.png', size: 512, maskable: true },
  { name: 'apple-touch-icon.png', size: 180 },
];

for (const { name, size, maskable } of sizes) {
  let pipeline = sharp(svg, { density: Math.round(72 * size / 32) })
    .resize(size, size);

  if (maskable) {
    // maskable: add 10% safe-zone padding with bg
    const inner = Math.round(size * 0.8);
    const pad = Math.round(size * 0.1);
    pipeline = sharp(svg, { density: Math.round(72 * inner / 32) })
      .resize(inner, inner)
      .extend({ top: pad, bottom: pad, left: pad, right: pad, background: '#1e3a5f' });
  }

  await pipeline.png().toFile(join(outDir, name));
  console.log(`Generated ${name} (${size}x${size})`);
}
