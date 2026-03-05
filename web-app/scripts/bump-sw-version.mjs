import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const swPath = join(__dirname, '..', 'public', 'sw.js');

// Hash based on all cached asset contents
const assetsDir = join(__dirname, '..', 'public');
const sw = readFileSync(swPath, 'utf8');

// Extract ASSETS array file list
const assetsMatch = sw.match(/const ASSETS = \[([\s\S]*?)\];/);
if (!assetsMatch) {
  console.log('Could not find ASSETS array in sw.js');
  process.exit(1);
}

const files = assetsMatch[1].match(/'([^']+)'/g).map(s => s.replace(/'/g, ''));
const hash = createHash('md5');

for (const file of files) {
  try {
    hash.update(readFileSync(join(assetsDir, file)));
  } catch { /* file might not exist yet */ }
}

const version = hash.digest('hex').slice(0, 8);
const updated = sw.replace(/const CACHE_VERSION = '[^']*'/, `const CACHE_VERSION = '${version}'`);

writeFileSync(swPath, updated);
console.log(`SW cache version updated to: ${version}`);
