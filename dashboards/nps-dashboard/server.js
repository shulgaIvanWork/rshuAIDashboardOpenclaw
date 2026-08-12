/**
 * nps-dashboard/server.js — NPS: обратная связь по программам.
 *
 * API:
 *   GET  /api/data            → все NPS-агрегаты за указанный год
 *   GET  /api/data?year=2025  → за конкретный год
 *   POST /api/export          → выгрузка присланных клиентом таблиц в Excel (xlsx)
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

// Excel-экспорт: клиент присылает уже посчитанные таблицы, сервер формирует xlsx
// (единый паттерн со всеми дашбордами — см. ratings-dashboard/server.js).
app.post('/api/export', async (req, res) => {
  try {
    const { sheets, fileName } = req.body || {};
    if (!Array.isArray(sheets) || !sheets.length) return res.status(400).json({ error: 'Нет данных для экспорта' });
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = 'RSHU Dashboard';
    wb.created = new Date();
    for (const s of sheets) {
      const ws = wb.addWorksheet(String(s.name || 'Лист').slice(0, 31));
      if (Array.isArray(s.header)) {
        ws.addRow(s.header);
        ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF093EB4' } };
        ws.views = [{ state: 'frozen', ySplit: 1 }];
      }
      (s.rows || []).forEach(r => ws.addRow(r));
      ws.columns.forEach((c, i) => { c.width = i === 0 ? 28 : 16; });
      if (Array.isArray(s.header)) ws.autoFilter = { from: 'A1', to: { row: 1, column: s.header.length } };
    }
    const buf = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${(fileName || 'nps.xlsx').replace(/[^\w.\-]/g, '_')}"`);
    res.send(Buffer.from(buf));
  } catch (e) {
    console.error('[nps] /api/export error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

export default app;