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
import path from 'path';
import { fileURLToPath } from 'url';

import { getNps, getCacheAt } from '@rshu/data-service/agg-cache.js';
import { YEAR } from '@rshu/data-service/lib/deal-rules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
      _loadedAt: new Date(getCacheAt()).toISOString(),
      _year: year,
    }));
  } catch (e) {
    console.error('[nps] /api/data error:', e.message);
    res.status(503).json({ error: e.message });
  }
});

// API: доступные года (из загруженных данных)
app.get('/api/years', async (req, res) => {
  try {
    const cur = await getNps(YEAR);
    const prev = YEAR > 2024 ? await getNps(YEAR - 1) : null;

    const years = [];
    if (prev && prev.months.some(m => m.sent > 0)) years.push(YEAR - 1);
    if (cur && cur.months.some(m => m.sent > 0)) years.push(YEAR);

    res.json(years.length ? years : [YEAR]);
  } catch (e) {
    res.json([YEAR]);
  }
});

export default app;
