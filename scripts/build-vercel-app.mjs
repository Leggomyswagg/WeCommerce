import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const name = process.argv[2];
if (!['api', 'web'].includes(name)) throw new Error('Choose the api or web app');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'apps', name, 'public');
mkdirSync(output, { recursive: true });
copyFileSync(join(root, 'public', 'index.html'), join(output, 'index.html'));
console.log(`Built ${name} dashboard output in apps/${name}/public`);
