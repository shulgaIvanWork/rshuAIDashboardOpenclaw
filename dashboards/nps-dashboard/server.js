/**
 * nps-dashboard/server.js — NPS: обратная связь по программам.
 *
 * API:
 *   GET /api/data            → все NPS-агрегаты за указанный год
 *   GET /api/data?year=2025  → за конкретный год
 *
 * Данные из отдельного файла post-sale-deals.json — не влияют на другие дашборды.
 */

import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import { getNps } from '@rshu/data-service/agg-cache.js';
import { YEAR } from '@rshu/data-service/lib/deal-rules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FETCHED_AT_PATH = path.join(__dirname, '..', '..', 'data-service', 'cache', 'fetched_at.json');

// Время последней выгрузки из Б24 (как в участниках/рейтингах/управленческом)
async function getFetchedAt() {
  try {
    const j = JSON.parse(await fs.readFile(FETCHED_AT_PATH, 'utf-8'));
    return j.fetchedAt || null;
  } catch {
    return null;
  }
}

const app = express();
app.set('etag', false);
app.use(express.json({ limit: '50mb' }));

// Статика
app.use(express.static(path.join(__dirname, 'public')));

// API: NPS данные за год
app.get('/api/data', async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || YEAR;
    const data = await getNps(year);
    res.json(Object.assign({}, data, {
      _loadedAt: (await getFetchedAt()) || new Date().toISOString(),
      _year: year,
    }));
  } catch (e) {
    console.error('[nps] /api/data error:', e.message);
    res.status(503).json({ error: e.message });
  }
});

export default app;