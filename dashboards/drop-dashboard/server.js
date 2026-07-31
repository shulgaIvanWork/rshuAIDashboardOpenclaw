/**
 * drop-dashboard/server.js — «ДРОП: отчёт по продажам» (sub-app). В РАЗРАБОТКЕ.
 *
 * ЗАЧЕМ: черновой дашборд продаж (ранняя версия отчёта), тонкий сервер поверх getAgg().
 * ЧТО ДЕЛАЕТ (API): /api/status, /api/user, /api/data, /api/data/new — агрегаты и мета.
 * Источник данных: getAgg() из data-service. Фронт ещё не финализирован.
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAgg, getCacheAt } from '@rshu/data-service/agg-cache.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DS_CACHE = path.resolve(__dirname, '../../data-service/cache');

// --- Express ---
const app = express();
app.use(express.json({ limit: '50mb' }));

// Status
app.get('/api/status', (req, res) => {
  const ts = getCacheAt();
  res.json({
    ready: ts > 0,
    loading: false,
    error: null,
    loadedAt: ts > 0 ? new Date(ts).toISOString() : null,
  });
});

// User info
app.get('/api/user', (req, res) => {
  res.json({ role: (req.user && req.user.role) || 'guest' });
});

// Main data
app.get('/api/data', async (req, res) => {
  try {
    const data = await getAgg();
    res.json(Object.assign({}, data, { _loadedAt: data.fetched_at || new Date(getCacheAt()).toISOString() }));
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
});

// New-logic data (same source — kept for UI compatibility)
app.get('/api/data/new', async (req, res) => {
  try {
    const data = await getAgg();
    res.json(Object.assign({}, data, { _loadedAt: data.fetched_at || new Date(getCacheAt()).toISOString() }));
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
});



// Static files
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

app.get(/(.*)/,  (req, res) => { if (path.extname(req.path)) return res.status(404).end(); res.sendFile(path.join(__dirname, 'public', 'index.html')); });

export default app;
