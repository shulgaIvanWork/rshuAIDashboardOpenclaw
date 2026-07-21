import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFile } from 'fs/promises';
import { getAgg, getCacheAt } from '@rshu/data-service/agg-cache.js';
import { isKomDeal, isInternalSource, detectFormat, detectB2b, VALID_CATS, MIN_OPP, YEAR } from '@rshu/data-service/lib/deal-rules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DS_CACHE = path.resolve(__dirname, '../../data-service/cache');
const PLANS_FILE = path.join(__dirname, 'data', 'plans.json');

const app = express();
app.use(express.json({ limit: '50mb' }));

// ── Вспомогательные ──────────────────────────────────────────────────────────
function daysBetween(a, b) { return Math.round((b - a) / 86400000); }
function dateOnly(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

function isPaid(d) {
  if (!d.UF_DATE_PAY_1C) return false;
  if (parseFloat(d.OPPORTUNITY || 0) < MIN_OPP) return false;
  return true;
}
function getPayDate(d) {
  if (!isPaid(d)) return null;
  return dateOnly(new Date(d.UF_DATE_PAY_1C.slice(0, 10)));
}

function isInWork(d, targetDate) {
  if (!d.DATE_CREATE) return false;
  const td = dateOnly(new Date(targetDate));
  const cd = dateOnly(new Date(d.DATE_CREATE.slice(0, 10)));
  if (cd > td) return false;
  if (parseFloat(d.OPPORTUNITY || 0) < MIN_OPP) return false;
  if (d.CLOSED === 'Y' && d.STAGE_SEMANTIC_ID === 'S' && d.CLOSEDATE) {
    if (dateOnly(new Date(d.CLOSEDATE.slice(0, 10))) <= td) return false;
  }
  if (d.CLOSED === 'Y' && d.STAGE_SEMANTIC_ID === 'F' && d.CLOSEDATE) {
    if (dateOnly(new Date(d.CLOSEDATE.slice(0, 10))) <= td) return false;
  }
  if (d.UF_DATE_PAY_1C) {
    if (dateOnly(new Date(d.UF_DATE_PAY_1C.slice(0, 10))) <= td) return false;
  }
  if (d.UF_CRM_1753341391806) {
    if (dateOnly(new Date(d.UF_CRM_1753341391806.slice(0, 10))) <= td) return false;
  }
  return true;
}

// ── Enrich deal (mirrors analyze.js) ────────────────────────────────────────
function enrichDeal(x, usersMap, sourcesMap, cats) {
  const catId = parseInt(x.CATEGORY_ID || 0);
  return {
    ID: x.ID, TITLE: x.TITLE || '',
    OPP: parseFloat(x.OPPORTUNITY || 0),
    SEM: x.STAGE_SEMANTIC_ID || null, STAGE: x.STAGE_ID || '',
    DC: x.DATE_CREATE ? dateOnly(new Date(x.DATE_CREATE.slice(0, 10))) : null,
    CL: x.CLOSEDATE ? dateOnly(new Date(x.CLOSEDATE.slice(0, 10))) : null,
    PAY_DT: getPayDate(x),
    CLOSED: x.CLOSED,
    MGR: usersMap[String(x.ASSIGNED_BY_ID || '')] || x.ASSIGNED_BY_ID || '',
    MGR_ID: String(x.ASSIGNED_BY_ID || ''),
    CAT: cats[String(catId)] || String(catId), CAT_ID: catId,
    SRC: sourcesMap[x.SOURCE_ID || ''] || x.SOURCE_ID || '—',
    SRC_ID: x.SOURCE_ID || '',
    FORMAT: detectFormat(x.TITLE || '', x.UF_FORMAT),
    COMPANY_ID: String(x.COMPANY_ID || '0'),
    BTYPE: detectB2b(x),
    IS_KOM: isKomDeal(x), IS_OOM: !isKomDeal(x),
    INV_DT: x.UF_CRM_1753272713011 ? dateOnly(new Date(x.UF_CRM_1753272713011.slice(0, 10))) : null,
  };
}

// ── Cache ────────────────────────────────────────────────────────────────────
let dealsCache = null, dictsCache = null, lastTs = 0;

async function ensureCache() {
  const ts = getCacheAt();
  if (ts === lastTs && dealsCache) return;
  lastTs = ts;
  const raw = JSON.parse(await readFile(path.join(DS_CACHE, 'deals.json'), 'utf-8'));
  dictsCache = JSON.parse(await readFile(path.join(DS_CACHE, 'dicts.json'), 'utf-8'));
  const usersMap = dictsCache.users || {};
  const sourcesMap = dictsCache.sources || {};
  const cats = dictsCache.categories || {};
  dealsCache = raw.map(x => enrichDeal(x, usersMap, sourcesMap, cats));
}

// ── API ──────────────────────────────────────────────────────────────────────

app.get('/api/status', (req, res) => {
  const ts = getCacheAt();
  res.json({ ready: ts > 0, loadedAt: ts > 0 ? new Date(ts).toISOString() : null });
});

// Основные агрегированные данные
app.get('/api/data', async (req, res) => {
  try {
    const data = await getAgg();
    res.json(Object.assign({}, data, { _loadedAt: data.fetched_at || new Date(getCacheAt()).toISOString() }));
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
});

// Менеджеры: таблица + воронка
app.get('/api/managers', async (req, res) => {
  try {
    await ensureCache();
    const deals = dealsCache;
    const agg = {};  // MGR → { leads, mql, sql, invoice_cnt, deals, postupleniya, durs, inWork }
    for (const r of deals) {
      const m = r.MGR;
      if (!agg[m]) agg[m] = { leads: 0, mql: 0, sql: 0, invoice_cnt: 0, oom_deals: 0, oom_sum: 0, kom_deals: 0, kom_sum: 0, durs: [] };
      if (r.DC && r.DC.getFullYear() === YEAR && VALID_CATS.has(r.CAT_ID)) {
        if (r.SEM !== 'S' || r.OPP >= MIN_OPP) agg[m].leads++;
      }
      if (isPaid(r)) {
        if (r.IS_OOM) { agg[m].oom_deals++; agg[m].oom_sum += r.OPP; }
        if (r.IS_KOM) { agg[m].kom_deals++; agg[m].kom_sum += r.OPP; }
        agg[m].mql++;
        agg[m].sql++;
        agg[m].invoice_cnt += r.INV_DT ? 1 : 0;
        agg[m].deals++;
        agg[m].postupleniya += r.OPP;
        if (r.DC && r.PAY_DT) { const d = daysBetween(r.DC, r.PAY_DT); if (d >= 0) agg[m].durs.push(d); }
      }
    }
    // «В работе» на сегодня по менеджерам
    const today = dateOnly(new Date());
    const inWorkMgr = {};
    for (const r of deals) {
      if (isInWork(r, today) && r.MGR) {
        inWorkMgr[r.MGR] = (inWorkMgr[r.MGR] || 0) + 1;
      }
    }
    const list = Object.entries(agg).filter(([, v]) => v.postupleniya > 0 || v.leads > 0)
      .map(([name, d]) => ({
        name, leads: d.leads, deals: d.deals, postupleniya: Math.round(d.postupleniya),
        oom_deals: d.oom_deals, oom_sum: Math.round(d.oom_sum),
        kom_deals: d.kom_deals, kom_sum: Math.round(d.kom_sum),
        avg_check: d.deals ? Math.round(d.postupleniya / d.deals) : 0,
        avg_dur: d.durs.length ? Math.round(d.durs.reduce((a, b) => a + b, 0) / d.durs.length * 10) / 10 : 0,
        in_work: inWorkMgr[name] || 0,
        conv: d.leads > 0 ? Math.round(d.deals / d.leads * 1000) / 10 : 0,
      })).sort((a, b) => b.postupleniya - a.postupleniya);
    res.json(list);
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
});

// Сделки конкретного менеджера (для карточки)
app.get('/api/manager-deals', async (req, res) => {
  try {
    await ensureCache();
    const mgr = req.query.name || '';
    if (!mgr) return res.json([]);
    const today = dateOnly(new Date());
    const list = dealsCache.filter(r => r.MGR === mgr)
      .map(r => ({
        id: r.ID, title: r.TITLE, opp: r.OPP, stage: r.STAGE, cat: r.CAT,
        dc: r.DC ? r.DC.toISOString().slice(0, 10) : null,
        pay_dt: r.PAY_DT ? r.PAY_DT.toISOString().slice(0, 10) : null,
        days_since_create: r.DC ? daysBetween(r.DC, today) : null,
        days_in_stage: r.DC && r.CL ? daysBetween(r.DC, r.CL) : null,
        format: r.FORMAT, btype: r.BTYPE, is_kom: r.IS_KOM,
        is_paid: !!r.PAY_DT, in_work: isInWork(r, today),
        src: r.SRC,
      })).sort((a, b) => (b.pay_dt || b.dc || '') > (a.pay_dt || a.dc || '') ? 1 : -1);
    res.json(list);
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
});

// Carryover / Конвейер
app.get('/api/carryover', async (req, res) => {
  try {
    await ensureCache();
    const agg = { inWork: 0, inWorkSum: 0, created: 0, createdSum: 0, paid: 0, paidSum: 0, lost: 0, lostSum: 0 };
    const today = dateOnly(new Date());
    for (const r of dealsCache) {
      if (!r.DC || r.DC.getFullYear() !== YEAR) continue;
      if (isInWork(r, today)) { agg.inWork++; agg.inWorkSum += r.OPP; }
      if (isPaid(r)) { agg.paid++; agg.paidSum += r.OPP; }
      if (r.SEM === 'F' && r.CL && r.CL.getFullYear() === YEAR) { agg.lost++; agg.lostSum += r.OPP; }
    }
    agg.created = agg.inWork + agg.paid + agg.lost;
    agg.createdSum = agg.inWorkSum + agg.paidSum + agg.lostSum;
    res.json(agg);
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
});

// Планы
app.get('/api/plans', async (req, res) => {
  try {
    const raw = await readFile(PLANS_FILE, 'utf-8');
    res.json(JSON.parse(raw));
  } catch { res.json({}); }
});

// ── Static ────────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, fp) => {
    if (fp.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
}));
app.get(/(.*)/, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

export default app;
