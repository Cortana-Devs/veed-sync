#!/usr/bin/env node
/*
  Generate assets/dancing_GIF/index.json listing all .gif/.webp/.png files.
  Runs before dev/build so the web app can lazy-load an index at runtime.
*/
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const TARGET_DIRS = [
  path.join(ROOT, 'assets', 'dancing_GIF'),
  path.join(ROOT, 'assets', 'dancing_WEBP'),
];

function safeMkdir(p){ try { fs.mkdirSync(p, { recursive: true }); } catch(_) {} }

function main(){
  try {
    TARGET_DIRS.forEach((DIR) => {
      if (!fs.existsSync(DIR)) {
        console.warn('[dancers] Directory not found:', DIR);
        return;
      }
      const files = fs.readdirSync(DIR)
        .filter((f) => /\.(gif|webp|png)$/i.test(f))
        .sort((a,b) => a.localeCompare(b));
      const data = { files };
      safeMkdir(DIR);
      const indexPath = path.join(DIR, 'index.json');
      fs.writeFileSync(indexPath, JSON.stringify(data, null, 2));
      console.log(`[dancers] Indexed ${files.length} file(s) →`, path.relative(ROOT, indexPath));
    });
  } catch (e) {
    console.warn('[dancers] Failed to generate index:', e && e.message);
  }
}

main();


