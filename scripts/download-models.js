#!/usr/bin/env node
/*
  Downloads models defined in scripts/models.config.json into assets/models/<category>/
  and generates assets/models/index.json for the web UI to load.

  Usage:
    node scripts/download-models.js
*/
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'scripts', 'models.config.json');
const OUT_DIR = path.join(ROOT, 'assets', 'models');
const INDEX_PATH = path.join(OUT_DIR, 'index.json');

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const req = proto.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // redirect
        res.resume();
        return resolve(download(res.headers.location, dest));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed ${url}: ${res.statusCode}`));
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(dest)));
      file.on('error', reject);
    });
    req.on('error', reject);
  });
}

async function main() {
  ensureDir(OUT_DIR);
  const cfgRaw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  const cfg = JSON.parse(cfgRaw);
  const index = {};
  for (const [category, items] of Object.entries(cfg)) {
    const catDir = path.join(OUT_DIR, category);
    ensureDir(catDir);
    index[category] = [];
    for (const item of items) {
      const url = item.url;
      const name = item.name || path.basename(url).replace(/\.[^/.]+$/, '');
      const ext = path.extname(url).toLowerCase() || '.obj';
      const filename = `${name}${ext}`;
      const outPath = path.join(catDir, filename);
      console.log(`Downloading ${url} -> ${path.relative(ROOT, outPath)}`);
      try {
        await download(url, outPath);
        index[category].push({ name, file: `assets/models/${category}/${filename}` });
      } catch (e) {
        console.error(`Failed to download ${url}:`, e.message);
      }
    }
  }
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
  console.log(`Wrote index: ${path.relative(ROOT, INDEX_PATH)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });


