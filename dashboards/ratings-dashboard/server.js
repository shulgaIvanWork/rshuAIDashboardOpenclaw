/**
 * ratings-dashboard/server.js — дашборд «Рейтинги» (sub-app оболочки).
 *
 * ЗАЧЕМ:
 *   Рейтинги продаж по продуктам / источникам / компаниям за период. Тонкий
 *   сервер: отдаёт недельные агрегаты, а сами таблицы РЕЙТИНГОВ считаются НА
 *   КЛИЕНТЕ из weeks[].by_prod/by_src/by_company (см. README — важная договорённость:
 *   любые фильтры надо дублировать в недельной агрегации analyze.js).
 *
 * ЧТО ДЕЛАЕТ (API):
 *   GET /api/data,/data/new — агрегаты из getAgg() (недели + YTD);
 *   GET /api/artifacts      — аномалии данных (возвраты, оплаты без сделки и т.п.);
 *   POST /api/export        — выгрузка текущего среза в Excel;
 *   catch-all — index.html только на путях БЕЗ расширения.
 *
 * ВЁРСТКА: только shared.css (без Bootstrap — reboot ломает кастомную вёрстку).
 */

import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAgg, getCacheAt, getRatingsCtx, buildRangeBuckets } from '@rshu/data-service/agg-cache.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3000', 10);
const DEALS_PATH = path.join(__dirname, '..', '..', 'data-service', 'cache', 'deals.json');

const app = express();
app.set('etag', false);
app.use(express.json({ limit: '50mb' }));

app.get('/api/user', (req, res) => {
  res.json({ role: (req.user && req.user.role) || 'guest' });
});

app.get('/api/data', async (req, res) => {
  try {
    const data = await getAgg();
    res.json(Object.assign({}, data, { _loadedAt: data.fetched_at || new Date(getCacheAt()).toISOString() }));
  } catch (e) {
    console.error('/api/data error:', e.message);
    res.status(503).json({ error: e.message });
  }
});

// Alias for legacy frontend calls
app.get('/api/data/new', async (req, res) => {
  try {
    const data = await getAgg();
    res.json(Object.assign({}, data, { _loadedAt: data.fetched_at || new Date(getCacheAt()).toISOString() }));
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
});

// Разбор даты YYYY-MM-DD в локальную полночь — как parseDt в analyze.js, иначе
// границы периода разъедутся. Проверяет календарь: 2026-02-31 отвергается.
function parseYmd(v) {
  const p = String(v || '').split('-');
  if (p.length !== 3 || p[0].length !== 4 || p[1].length !== 2 || p[2].length !== 2) return null;
  const y = Number(p[0]), m = Number(p[1]), d = Number(p[2]);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return dt;
}
// Рейтинги за ТОЧНЫЕ даты. Клиент раньше суммировал целые НЕДЕЛИ, из-за чего
// «август» превращался в W31-W36 (27.07-06.09) и не сходился с управленческим
// дашбордом: 133 сделки против 111. Ответ имеет форму ОДНОЙ недельной корзины,
// поэтому клиентская агрегация используется без изменений.
app.get('/api/data/range', async (req, res) => {
  try {
    const { from, to } = req.query;
    const dFrom = parseYmd(from), dTo = parseYmd(to);
    if (!dFrom || !dTo) {
      return res.status(400).json({ error: 'from и to обязательны в формате YYYY-MM-DD' });
    }
    if (dFrom > dTo) {
      return res.status(400).json({ error: 'некорректный диапазон дат: from позже to' });
    }
    const bucket = buildRangeBuckets(await getRatingsCtx(), dFrom, dTo);
    res.json(Object.assign({ from, to, week: 0 }, bucket,
      { _loadedAt: new Date(getCacheAt()).toISOString() }));
  } catch (e) {
    console.error('/api/data/range error:', e.message);
    res.status(503).json({ error: e.message });
  }
});

app.get('/api/artifacts', async (req, res) => {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  try {
    const deals = JSON.parse(await fs.readFile(DEALS_PATH, 'utf-8'));
    const withPay = deals.filter(d => d.UF_DATE_PAY_1C);

    const returns = withPay
      .filter(d => d.STAGE_SEMANTIC_ID === 'F' && (parseFloat(d.OPPORTUNITY) || 0) > 0)
      .map(d => ({ id: d.ID, title: d.TITLE, sum: parseFloat(d.OPPORTUNITY) || 0, date: d.UF_DATE_PAY_1C, created: d.DATE_CREATE, manager: d.ASSIGNED_BY_ID }));

    const inProgressPaid = withPay
      .filter(d => d.STAGE_SEMANTIC_ID === 'P' && (parseFloat(d.OPPORTUNITY) || 0) > 0)
      .map(d => ({ id: d.ID, title: d.TITLE, sum: parseFloat(d.OPPORTUNITY) || 0, date: d.UF_DATE_PAY_1C, created: d.DATE_CREATE, manager: d.ASSIGNED_BY_ID }));

    const wonNoPay = deals
      .filter(d => d.STAGE_SEMANTIC_ID === 'S' && !d.UF_DATE_PAY_1C && (parseFloat(d.OPPORTUNITY) || 0) > 0);

    const negativeDur = withPay.filter(d => {
      if (!d.DATE_CREATE) return false;
      const pay = new Date(d.UF_DATE_PAY_1C.substring(0, 10));
      const create = new Date(d.DATE_CREATE.substring(0, 10));
      return !isNaN(pay) && !isNaN(create) && pay < create;
    });

    const nextYear = deals
      .filter(d => { const s = String(d.STAGE_ID || ''); return s === 'UC_W6SCHG' || s.endsWith(':UC_W6SCHG'); })
      .map(d => ({ id: d.ID, title: d.TITLE, sum: parseFloat(d.OPPORTUNITY) || 0, sem: d.STAGE_SEMANTIC_ID, cat: d.CATEGORY_ID, manager: d.ASSIGNED_BY_ID, created: d.DATE_CREATE }));

    const validCats = new Set(['0', '8', '19']);
    const otherCatPaid = withPay
      .filter(d => !validCats.has(String(d.CATEGORY_ID)) && (parseFloat(d.OPPORTUNITY) || 0) > 0)
      .map(d => ({ id: d.ID, title: d.TITLE, sum: parseFloat(d.OPPORTUNITY) || 0, date: d.UF_DATE_PAY_1C, cat: d.CATEGORY_ID, sem: d.STAGE_SEMANTIC_ID }));

    function isKomDeal(d) {
      if (String(d.CATEGORY_ID) === '19') return true;
      if (d.UF_CRM_1683882427069 === 'Y' || d.UF_CRM_1683882427069 === '1') return true;
      if (String(d.UF_FORMAT) === '19042498') return true;
      const dir = d.UF_CRM_1498466811;
      if (dir && (Array.isArray(dir) ? dir.includes('1906') : String(dir) === '1906')) return true;
      if (String(d.UF_CRM_1765896709800 || '') === '34765') return true;
      return false;
    }
    const komInPresale = deals
      .filter(d => String(d.CATEGORY_ID) === '8' && isKomDeal(d) && d.STAGE_SEMANTIC_ID !== 'S')
      .map(d => ({ id: d.ID, title: d.TITLE, sum: parseFloat(d.OPPORTUNITY) || 0, sem: d.STAGE_SEMANTIC_ID, stage: d.STAGE_ID }));

    const sum = arr => arr.reduce((a, b) => a + (b.sum || 0), 0);
    res.json({
      summary: {
        returns:          { cnt: returns.length,        sum: sum(returns) },
        inProgressPaid:   { cnt: inProgressPaid.length, sum: sum(inProgressPaid) },
        wonNoPay:         { cnt: wonNoPay.length,       sum: wonNoPay.reduce((a, b) => a + (parseFloat(b.OPPORTUNITY) || 0), 0) },
        negativeDuration: { cnt: negativeDur.length,    sum: negativeDur.reduce((a, b) => a + (parseFloat(b.OPPORTUNITY) || 0), 0) },
        otherCatPaid:     { cnt: otherCatPaid.length,   sum: sum(otherCatPaid) },
        komInPresale:     { cnt: komInPresale.length },
        nextYear:         { cnt: nextYear.length,       sum: sum(nextYear) },
      },
      details: {
        returns: returns.slice(0, 50),
        inProgressPaid: inProgressPaid.slice(0, 50),
        wonNoPay: wonNoPay.slice(0, 50).map(d => ({ id: d.ID, title: d.TITLE, sum: parseFloat(d.OPPORTUNITY) || 0, created: d.DATE_CREATE, manager: d.ASSIGNED_BY_ID })),
        otherCatPaid: otherCatPaid.slice(0, 50),
        komInPresale: komInPresale.slice(0, 50),
        nextYear: nextYear.slice(0, 50),
      }
    });
  } catch (e) {
    console.error('/api/artifacts error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Excel-экспорт: клиент присылает уже посчитанные таблицы за выбранный период
// (единый источник агрегации — клиентский buildFilteredData), сервер формирует xlsx.
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
      ws.columns.forEach((c, i) => { c.width = i === 1 ? 34 : 16; });
      if (Array.isArray(s.header)) ws.autoFilter = { from: 'A1', to: { row: 1, column: s.header.length } };
    }
    const buf = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${(fileName || 'ratings.xlsx').replace(/[^\w.\-]/g, '_')}"`);
    res.send(Buffer.from(buf));
  } catch (e) {
    console.error('/api/export error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

app.get(/(.*)/,  (req, res) => {
  // Пути с расширением (guide.pdf, отсутствующие ассеты) → 404, а не HTML-заглушка
  if (path.extname(req.path)) return res.status(404).end();
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

export default app;

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  app.listen(PORT, '0.0.0.0', () => console.log(`🍀 Рейтинги на http://0.0.0.0:${PORT}`));
}
