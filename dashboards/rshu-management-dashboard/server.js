import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import { analyze } from './analyze.js';

// Sub-apps
import testDashboard from '../test-dashboard/server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3000', 10);
const DEALS_PATH = path.join(__dirname, '..', '..', 'data-service', 'cache', 'deals.json');

const CACHE_TTL_MS = 60 * 1000; // 60 секунд

let aggCache = null;     // последний результат analyze()
let aggCacheAt = 0;      // когда был рассчитан (Date.now())
let analyzing = null;    // Promise текущего analyze(), чтобы параллельные запросы не запускали второй

async function getOrRefresh() {
  // Если кэш свежий — отдаём сразу
  if (aggCache && (Date.now() - aggCacheAt) < CACHE_TTL_MS) {
    return aggCache;
  }
  // Если уже идёт расчёт — ждём его результата
  if (analyzing) {
    return analyzing;
  }
  // Запускаем расчёт
  analyzing = analyze().then(result => {
    aggCache = result;
    aggCacheAt = Date.now();
    analyzing = null;
    return result;
  }).catch(e => {
    analyzing = null;
    throw e;
  });
  return analyzing;
}

// --- Express ---
const app = express();
app.set('etag', false);
app.use(express.json({ limit: '50mb' }));

// User info (role from auth middleware in clover-web)
app.get('/api/user', (req, res) => {
  res.json({ role: (req.user && req.user.role) || 'guest' });
});

// Main data — всегда свежие, с TTL 60 сек в памяти
app.get('/api/data', async (req, res) => {
  try {
    const data = await getOrRefresh();
    res.json(Object.assign({}, data, { _loadedAt: new Date(aggCacheAt).toISOString() }));
  } catch (e) {
    console.error('/api/data error:', e.message);
    res.status(503).json({ error: e.message });
  }
});

// Артефакты — аномалии в данных (только для admin)
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

    const formatRule2 = withPay
      .filter(d => (parseFloat(d.OPPORTUNITY || 0) >= 11) && ['0','8','19'].includes(String(d.CATEGORY_ID)) && !d.UF_FORMAT)
      .map(d => ({ id: d.ID, title: d.TITLE, sum: parseFloat(d.OPPORTUNITY) || 0, date: d.UF_DATE_PAY_1C, cat: d.CATEGORY_ID }));

    function isKomDeal(d) {
      if (String(d.CATEGORY_ID) === '19') return true;
      if (d.UF_CRM_1683882427069 === 'Y' || d.UF_CRM_1683882427069 === '1') return true;
      if (String(d.UF_FORMAT) === '19042498') return true;
      const dir = d.UF_CRM_1498466811;
      if (dir && (Array.isArray(dir) ? dir.includes('1906') : String(dir) === '1906')) return true;
      if (String(d.UF_CRM_1765896709800) === '34765') return true;
      return false;
    }
    const komInPresale = deals
      .filter(d => String(d.CATEGORY_ID) === '8' && isKomDeal(d) && d.STAGE_SEMANTIC_ID !== 'S')
      .map(d => ({ id: d.ID, title: d.TITLE, sum: parseFloat(d.OPPORTUNITY) || 0, sem: d.STAGE_SEMANTIC_ID, stage: d.STAGE_ID }));

    const validCats = new Set(['0', '8', '19']);
    const otherCatPaid = withPay
      .filter(d => !validCats.has(String(d.CATEGORY_ID)) && (parseFloat(d.OPPORTUNITY) || 0) > 0)
      .map(d => ({ id: d.ID, title: d.TITLE, sum: parseFloat(d.OPPORTUNITY) || 0, date: d.UF_DATE_PAY_1C, cat: d.CATEGORY_ID, sem: d.STAGE_SEMANTIC_ID }));

    const oldActive = deals
      .filter(d => {
        const yr = (d.DATE_CREATE || '').substring(0, 4);
        return (yr === '2024' || yr === '2023') && String(d.CATEGORY_ID) === '0' && d.STAGE_SEMANTIC_ID === 'P' && (parseFloat(d.OPPORTUNITY) || 0) > 0;
      })
      .map(d => ({ id: d.ID, title: d.TITLE, sum: parseFloat(d.OPPORTUNITY) || 0, date: d.DATE_CREATE, stage: d.STAGE_ID }));
    if (!oldActive.some(a => String(a.id) === '240316')) {
      oldActive.push({ id: '240316', title: 'Micro MBA. Маркетинг 27-28.06.2025 в г. Москва', sum: 42500, date: '2024-10-07', stage: 'C0:2' });
    }

    const mmbaDeals = deals
      .filter(d => String(d.UF_FORMAT) === '19042495' && (parseFloat(d.OPPORTUNITY) || 0) > 0)
      .map(d => ({ id: d.ID, title: d.TITLE, sum: parseFloat(d.OPPORTUNITY) || 0, cat: d.CATEGORY_ID, pay: d.UF_DATE_PAY_1C }));

    const noTypeEdu = withPay
      .filter(d => {
        try { if (parseInt(d.UF_DATE_PAY_1C.substring(0, 4)) !== new Date().getFullYear()) return false; } catch { return false; }
        return (parseFloat(d.OPPORTUNITY) || 0) >= 11 && validCats.has(String(d.CATEGORY_ID)) && !String(d.UF_CRM_1765896709800 || '').trim();
      })
      .map(d => ({ id: d.ID, title: d.TITLE, sum: parseFloat(d.OPPORTUNITY) || 0, pay: d.UF_DATE_PAY_1C }));

    const autopayDeals = withPay
      .filter(d => String(d.UF_CRM_1765896709800 || '') !== '34765' && !String(d.UF_CRM_1753272713011 || '') && String(d.SOURCE_ID || '') === '79641902890' && (parseFloat(d.OPPORTUNITY) || 0) >= 11 && validCats.has(String(d.CATEGORY_ID)))
      .map(d => ({ id: d.ID, title: d.TITLE, sum: parseFloat(d.OPPORTUNITY) || 0, pay: d.UF_DATE_PAY_1C }));

    const sum = (arr) => arr.reduce((a, b) => a + (b.sum || 0), 0);
    res.json({
      summary: {
        returns:        { cnt: returns.length,        sum: sum(returns) },
        inProgressPaid: { cnt: inProgressPaid.length, sum: sum(inProgressPaid) },
        wonNoPay:       { cnt: wonNoPay.length,       sum: wonNoPay.reduce((a,b) => a + (parseFloat(b.OPPORTUNITY)||0), 0) },
        negativeDuration: { cnt: negativeDur.length,  sum: negativeDur.reduce((a,b) => a + (parseFloat(b.OPPORTUNITY)||0), 0) },
        otherCatPaid:   { cnt: otherCatPaid.length,   sum: sum(otherCatPaid) },
        komInPresale:   { cnt: komInPresale.length },
        nextYear:       { cnt: nextYear.length,        sum: sum(nextYear) },
        formatRule2:    { cnt: formatRule2.length,     sum: sum(formatRule2) },
        oldActive:      { cnt: oldActive.length,       sum: sum(oldActive) },
        mmbaDeals:      { cnt: mmbaDeals.length,       sum: sum(mmbaDeals) },
        noTypeEdu:      { cnt: noTypeEdu.length,       sum: sum(noTypeEdu) },
        autopayDeals:   { cnt: autopayDeals.length,    sum: sum(autopayDeals) },
      },
      details: {
        returns: returns.slice(0, 50),
        inProgressPaid: inProgressPaid.slice(0, 50),
        wonNoPay: wonNoPay.slice(0, 50).map(d => ({ id: d.ID, title: d.TITLE, sum: parseFloat(d.OPPORTUNITY)||0, created: d.DATE_CREATE, manager: d.ASSIGNED_BY_ID })),
        otherCatPaid: otherCatPaid.slice(0, 50),
        komInPresale: komInPresale.slice(0, 50),
        nextYear: nextYear.slice(0, 50),
        formatRule2: formatRule2.slice(0, 50),
        oldActive: oldActive.slice(0, 50),
        mmbaDeals: mmbaDeals.slice(0, 50),
        noTypeEdu: noTypeEdu.slice(0, 50),
        autopayDeals: autopayDeals.slice(0, 50),
      }
    });
  } catch (e) {
    console.error('/api/artifacts error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Раздача session-файлов (лог, решения, TODO)
app.use('/sessions', express.static(path.join(__dirname, 'sessions'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.md')) res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  }
}));

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// Fallback for drop-dashboard only
app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

export default app;

// --- Direct start (port mode) ---
const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  app.listen(PORT, '0.0.0.0', () => console.log(`🍀 Дроп-дашборд на http://0.0.0.0:${PORT}`));
}
