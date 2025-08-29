#!/usr/bin/env node
/*
  Downloads themed image assets (water/beach/sky/party) using the Pixabay API.
  Requires PIXABAY_API_KEY env var (free tier works): https://pixabay.com/api/docs/

  Usage:
    PIXABAY_API_KEY=your_key node scripts/download-assets.js
*/
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'scripts', 'assets.config.json');
const OUT_DIR = path.join(ROOT, 'assets', 'images');
const INDEX_PATH = path.join(OUT_DIR, 'index.json');

const API_KEY = process.env.PIXABAY_API_KEY || '';
if (!API_KEY) {
  console.error('Missing PIXABAY_API_KEY env var. Get one free at pixabay.com');
  process.exit(1);
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}: ${url}`));
        }
        const chunks = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => {
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
            resolve(json);
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}: ${url}`));
        }
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve(dest)));
        file.on('error', reject);
      })
      .on('error', reject);
  });
}

async function searchPixabayImages(query, limit = 6) {
  const q = encodeURIComponent(query);
  const url = `https://pixabay.com/api/?key=${API_KEY}&q=${q}&image_type=photo&orientation=horizontal&per_page=${limit}&safesearch=true&editors_choice=true`;
  const json = await fetchJSON(url);
  if (!json || !Array.isArray(json.hits)) return [];
  return json.hits.map((h) => ({
    url: h.largeImageURL || h.webformatURL,
    previewURL: h.previewURL,
    width: h.imageWidth,
    height: h.imageHeight,
    id: String(h.id),
    tags: h.tags || ''
  }));
}

async function main() {
  ensureDir(OUT_DIR);
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  const index = {};
  for (const item of cfg.images) {
    const { category, query, limit } = item;
    const catDir = path.join(OUT_DIR, category);
    ensureDir(catDir);
    index[category] = [];
    console.log(`Searching ${category}: "${query}" (limit ${limit})`);
    try {
      const results = await searchPixabayImages(query, limit || 6);
      for (const hit of results) {
        const name = `${category}_${hit.id}.jpg`;
        const outPath = path.join(catDir, name);
        console.log(`Downloading ${hit.url} -> ${path.relative(ROOT, outPath)}`);
        try {
          await download(hit.url, outPath);
          index[category].push({
            name,
            file: `assets/images/${category}/${name}`,
            width: hit.width,
            height: hit.height,
            tags: hit.tags
          });
        } catch (e) {
          console.warn(`Skip ${hit.url}: ${e.message}`);
        }
      }
    } catch (e) {
      console.error(`Search failed for ${category}:`, e.message);
    }
  }
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
  console.log(`Wrote index: ${path.relative(ROOT, INDEX_PATH)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });


