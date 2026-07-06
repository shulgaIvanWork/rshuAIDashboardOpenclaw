import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import { getAgg, getCacheAt } from '@rshu/data-service/agg-cache.js';
// Единые бизнес-правила (isKomDeal, границы сумм, источник «Регистрация»)
import { isKomDeal, MIN_OPP, REG_SRC_ID, VALID_CATS } from '@rshu/data-service/lib/deal-rules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3000', 10);
const DEALS_PATH = path.join(__dirname, '..', '..', 'data-service', 'cache', 'deals.json');

// --- Express ---
const app = express();
app.set('etag', false);
app.use(express.json({ limit: '50mb' }));

// User info (role from auth middleware in clover-web)
app.get('/api/user', (req, res) => {
  res.json({ role: (req.user && req.user.role) || 'guest' });
});

// Main data — всегда свежие, из общего кэша data-service
app.get('/api/data', async (req, res) => {
  try {
    const data = await getAgg();
    res.json(Object.assign({}, data, { _loadedAt: data.fetched_at || new Date(getCacheAt()).toISOString() }));
  } catch (e) {
    console.error('/api/data error:', e.message);
    res.status(503).json({ error: e.message });
  }
});

// Воронка регистраций с фильтром по дате создания
app.get('/api/reg-funnel', async (req, res) => {
  try {
    const { from, to } = req.query;

    const deals = JSON.parse(await fs.readFile(DEALS_PATH, 'utf-8'));

    let subset = deals.filter(d => {
      if (String(d.SOURCE_ID || '') !== REG_SRC_ID) return false;
      if (!VALID_CATS.has(parseInt(d.CATEGORY_ID || 0))) return false;
      return true;
    });

    if (from || to) {
      const dtFrom = from ? new Date(from) : null;
      const dtTo   = to   ? new Date(to + 'T23:59:59') : null;
      subset = subset.filter(d => {
        const dc = d.DATE_CREATE ? new Date(d.DATE_CREATE.substring(0, 10)) : null;
        if (!dc) return false;
        if (dtFrom && dc < dtFrom) return false;
        if (dtTo   && dc > dtTo)   return false;
        return true;
      });
    }

    function getOpp(d) { return parseFloat(d.OPPORTUNITY || 0); }
    function getPayDate(d) {
      const s = d.UF_DATE_PAY_1C || d.CLOSEDATE;
      return s ? s.substring(0, 10) : null;
    }
    function getInvDate(d) {
      const s = d.UF_CRM_1753272713011;
      return s ? s.substring(0, 10) : null;
    }
    function daysBetween(a, b) {
      if (!a || !b) return -1;
      return Math.round((new Date(b) - new Date(a)) / 86400000);
    }

    const SEM_LOSE = 'F', SEM_P = 'P';
    const regIsPaid    = d => !!d.UF_DATE_PAY_1C && getOpp(d) >= MIN_OPP;
    const regIsLose    = d => d.STAGE_SEMANTIC_ID === SEM_LOSE;
    const regIsInvoice = d => d.STAGE_SEMANTIC_ID !== SEM_LOSE && (!!getInvDate(d) || regIsPaid(d));
    const regIsSql     = d => d.STAGE_SEMANTIC_ID === SEM_P && getOpp(d) >= MIN_OPP && !getInvDate(d) && !d.UF_DATE_PAY_1C;

    let sql = 0, inv = 0, paid = 0, lose = 0, other = 0;
    let paidSum = 0, sqlSum = 0, invSum = 0, loseSum = 0;
    let realInvCnt = 0, realInvSum = 0;
    const paidDurs = [], invDurs = [];

    for (const d of subset) {
      const opp = getOpp(d);
      if (regIsLose(d))      { lose++; loseSum += opp; }
      else if (regIsInvoice(d)) { inv++;  invSum  += opp; }
      else if (regIsSql(d))  { sql++;  sqlSum  += opp; }
      else other++;
      if (regIsPaid(d))      { paid++; paidSum += opp; }

      const invDt = getInvDate(d);
      const invEff = invDt || (regIsPaid(d) ? getPayDate(d) : null);
      if (invEff && d.DATE_CREATE && d.STAGE_SEMANTIC_ID !== SEM_LOSE) {
        const dd = daysBetween(d.DATE_CREATE.substring(0, 10), invEff);
        if (dd >= 0) invDurs.push(dd);
      }
      if (invDt && d.STAGE_SEMANTIC_ID !== SEM_LOSE && !regIsPaid(d)) {
        realInvCnt++; realInvSum += opp;
      }
      if (regIsPaid(d)) {
        const pd = getPayDate(d);
        if (pd && d.DATE_CREATE) {
          const dd = daysBetween(d.DATE_CREATE.substring(0, 10), pd);
          if (dd >= 0) paidDurs.push(dd);
        }
      }
    }

    const total = subset.length;
    const totalPaid = paid;
    const totalPaidSum = paidSum;
    const avgDur    = paidDurs.length ? paidDurs.reduce((s, d) => s + d, 0) / paidDurs.length : 0;
    const avgInvDur = invDurs.length  ? invDurs.reduce((s, d) => s + d, 0)  / invDurs.length  : 0;

    res.json({
      total, sql, sql_sum: Math.round(sqlSum),
      invoice: inv, inv_sum: Math.round(invSum),
      paid, paid_sum: Math.round(paidSum),
      total_paid: totalPaid, total_paid_sum: Math.round(totalPaidSum),
      lose, lose_sum: Math.round(loseSum), other,
      avg_check:   totalPaid ? Math.round(totalPaidSum / totalPaid) : 0,
      avg_dur:     Math.round(avgDur * 10) / 10,
      avg_inv_dur: Math.round(avgInvDur * 10) / 10,
      conv:     total ? Math.round(totalPaid / total * 100 * 10) / 10 : 0,
      lose_pct: total ? Math.round(lose / total * 100 * 10) / 10 : 0,
      real_inv_cnt: realInvCnt, real_inv_sum: Math.round(realInvSum),
      inv_conv: total ? Math.round(inv / total * 100 * 10) / 10 : 0,
    });
  } catch (e) {
    console.error('/api/reg-funnel error:', e.message);
    res.status(500).json({ error: e.message });
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
      .filter(d => (parseFloat(d.OPPORTUNITY || 0) >= MIN_OPP) && VALID_CATS.has(parseInt(d.CATEGORY_ID || 0)) && !d.UF_FORMAT)
      .map(d => ({ id: d.ID, title: d.TITLE, sum: parseFloat(d.OPPORTUNITY) || 0, date: d.UF_DATE_PAY_1C, cat: d.CATEGORY_ID }));

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
        return (parseFloat(d.OPPORTUNITY) || 0) >= MIN_OPP && validCats.has(String(d.CATEGORY_ID)) && !String(d.UF_CRM_1765896709800 || '').trim();
      })
      .map(d => ({ id: d.ID, title: d.TITLE, sum: parseFloat(d.OPPORTUNITY) || 0, pay: d.UF_DATE_PAY_1C }));

    const autopayDeals = withPay
      .filter(d => String(d.UF_CRM_1765896709800 || '') !== '34765' && !String(d.UF_CRM_1753272713011 || '') && String(d.SOURCE_ID || '') === REG_SRC_ID && (parseFloat(d.OPPORTUNITY) || 0) >= MIN_OPP && validCats.has(String(d.CATEGORY_ID)))
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
app.get(/(.*)/,  (req, res) => {
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
