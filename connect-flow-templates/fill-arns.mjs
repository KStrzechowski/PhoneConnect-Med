import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const values = JSON.parse(readFileSync(join(root, 'fill-arns.local.json'), 'utf8'));
const outDir = join(root, 'filled');
mkdirSync(outDir, { recursive: true });

for (const dir of ['flows', 'modules']) {
  for (const file of readdirSync(join(root, dir))) {
    if (!file.endsWith('.json')) continue;
    let content = readFileSync(join(root, dir, file), 'utf8');
    let replaced = 0;
    for (const [placeholder, value] of Object.entries(values)) {
      const count = content.split(placeholder).length - 1;
      if (count > 0) {
        content = content.split(placeholder).join(value);
        replaced += count;
      }
    }
    if (replaced > 0) {
      writeFileSync(join(outDir, file), content);
      console.log(`${file}: filled ${replaced} placeholder(s)`);
    }
  }
}
