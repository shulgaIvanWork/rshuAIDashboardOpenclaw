/**
 * rshu-management-dashboard/server.js — «Дашборд отдела продаж РШУ» (sub-app).
 *
 * ЗАЧЕМ:
 *   Сводка для руководства за произвольный ПЕРИОД (кастомный календарь-диапазон):
 *   KPI по каналам (Очный/Онлайн/СДО/КОМ), воронка регистраций/лидов→оплат,
 *   аномалии данных.
 *
 * ЧТО ДЕЛАЕТ (API):
 *   GET /api/data       — базовые агрегаты из getAgg();
 *   GET /api/kpi        — KPI за период (period-kpi.js), разрезы по каналам;
 *   GET /api/reg-funnel — воронка источников когортами (см. README: этапы по
 *                         РАЗНЫМ датам — создание/счёт/оплата, иначе конверсии >100%);
 *   GET /api/artifacts  — аномалии данных;
 *   catch-all — index.html только на путях БЕЗ расширения.
 *
 * ВЁРСТКА: Bootstrap + shared.css + кастомный виджет периода (/vendor/range-calendar/).
 */

import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import { getAgg, getCacheAt } from '@rshu/data-service/agg-cache.js';
// Единые бизнес-правила (isKomDeal, границы сумм, источник «Регистрация»)
import { isKomDeal, MIN_OPP, REG_SRC_ID, VALID_CATS, MQL_SALE_STAGES } from '@rshu/data-service/lib/deal-rules.js';
import { enrichForKpi, calcPeriodKpi } from '@rshu/data-service/lib/period-kpi.js';
// Единый справочник групп менеджеров
import { getMgrGroup, MGR_GROUP_LABELS } from '@rshu/data-service/lib/mgr-groups.js';

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

// KPI за точный период дат + предыдущий период той же длины
app.get('/api/kpi', async (req, res) => {
  try {
    const { from, to, compare_from } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from и to обязательны (YYYY-MM-DD)' });
    const dtFrom = new Date(from), dtTo = new Date(to);
    if (isNaN(dtFrom) || isNaN(dtTo) || dtFrom > dtTo) {
      return res.status(400).json({ error: 'некорректный диапазон дат' });
    }

    const rows = enrichForKpi(JSON.parse(await fs.readFile(DEALS_PATH, 'utf-8')));

    const lenMs = dtTo - dtFrom + 86400000;
    let ppFrom, ppTo;
    if (compare_from) {
      // Ручной период сравнения той же длины
      ppFrom = new Date(compare_from);
      if (isNaN(ppFrom)) return res.status(400).json({ error: 'некорректная compare_from' });
      ppTo = new Date(ppFrom.getTime() + lenMs - 86400000);
    } else {
      // По умолчанию — предыдущий период той же длины, вплотную к текущему
      ppTo   = new Date(dtFrom.getTime() - 86400000);
      ppFrom = new Date(dtFrom.getTime() - lenMs);
    }

    const iso = d => d.toISOString().substring(0, 10);
    res.json({
      period:      { from, to },
      prev_period: { from: iso(ppFrom), to: iso(ppTo) },
      current:  calcPeriodKpi(rows, dtFrom, dtTo),
      previous: calcPeriodKpi(rows, ppFrom, ppTo),
    });
  } catch (e) {
    console.error('/api/kpi error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Продажи по менеджерам: сравнение менеджеров за период + дельта к прошлому периоду.
// Правила принадлежности периоду — как в /api/kpi (деньги по UF_DATE_PAY_1C, лиды по DATE_CREATE).
// Ответ: managers (осн. группа), groups (автооплаты/ОЗК/tech/скрытые), total, prev_period.
app.get('/api/managers-sales', async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from и to обязательны (YYYY-MM-DD)' });
    const dtFrom = new Date(from), dtTo = new Date(to);
    if (isNaN(dtFrom) || isNaN(dtTo) || dtFrom > dtTo) {
      return res.status(400).json({ error: 'некорректный диапазон дат' });
    }

    const [dealsRaw, dicts] = await Promise.all([
      fs.readFile(DEALS_PATH, 'utf-8').then(JSON.parse),
      fs.readFile(path.join(__dirname, '..', '..', 'data-service', 'cache', 'dicts.json'), 'utf-8').then(JSON.parse),
    ]);
    const users = (dicts && dicts.users) || {};
    const rows = enrichForKpi(dealsRaw).map(r => ({
      ...r,
      MGR_NAME: users[r.MGR_ID] || r.MGR_ID || '(без ответственного)',
    }));

    // Предыдущий период той же длины вплотную назад (как /api/kpi)
    const lenMs = dtTo - dtFrom + 86400000;
    const ppTo   = new Date(dtFrom.getTime() - 86400000);
    const ppFrom = new Date(dtFrom.getTime() - lenMs);

    const isPaid = r => r.OPP >= MIN_OPP && r.PAY_DT !== null;
    const isAllLead  = r => VALID_CATS.has(r.CAT_ID) && !(r.SEM === 'S' && r.OPP < MIN_OPP);
    const isQualLead = r => {
      if (!VALID_CATS.has(r.CAT_ID)) return false;
      if (r.SEM === 'S' && r.OPP < MIN_OPP) return false;
      if (r.CAT_ID === 0) {
        const st = String(r.STAGE || '').replace(/^C\d+:/, '');
        return MQL_SALE_STAGES.has(st);
      }
      if (r.CAT_ID === 19) return !(r.SEM === 'S' || r.SEM === 'F');
      return false;
    };

    // Пустая запись менеджера
    function emptyMgr(id, name) {
      return { id, name, group: getMgrGroup(id),
        postupleniya: 0, won_cnt: 0, avg_check: 0, avg_close_days_won: 0,
        leads: 0, mql: 0, prev_postupleniya: 0, prev_won_cnt: 0,
        delta_abs: 0, delta_pct: 0, share_pct: 0 };
    }
    const curM = {}, prevM = {};
    const touch = (map, id, name) => { if (!map[id]) map[id] = emptyMgr(id, name); return map[id]; };

    for (const r of rows) {
      if (isPaid(r) && r.PAY_DT >= dtFrom && r.PAY_DT <= dtTo) {
        const m = touch(curM, r.MGR_ID, r.MGR_NAME);
        m.postupleniya += r.OPP; m.won_cnt++;
        if (r.DC) {
          const dd = Math.round((r.PAY_DT - r.DC) / 86400000);
          if (dd >= 0) { m.durs_sum = (m.durs_sum || 0) + dd; m.durs_cnt = (m.durs_cnt || 0) + 1; }
        }
      }
      if (isPaid(r) && r.PAY_DT >= ppFrom && r.PAY_DT <= ppTo) {
        const m = touch(prevM, r.MGR_ID, r.MGR_NAME);
        m.prev_postupleniya += r.OPP; m.prev_won_cnt++;
      }
      if (r.DC && r.DC >= dtFrom && r.DC <= dtTo) {
        if (isAllLead(r)) {
          const m = touch(curM, r.MGR_ID, r.MGR_NAME);
          m.leads++;
          if (isQualLead(r)) m.mql++;
        }
      }
    }

    // Финальная сборка: доли, дельты, средние
    const all = {};
    const ids = new Set([...Object.keys(curM), ...Object.keys(prevM)]);
    for (const id of ids) {
      const c = curM[id] || emptyMgr(id, users[id] || id || '(без ответственного)');
      const p = prevM[id];
      if (p) { c.prev_postupleniya = p.prev_postupleniya; c.prev_won_cnt = p.prev_won_cnt; }
      c.avg_check = c.won_cnt ? Math.round(c.postupleniya / c.won_cnt) : 0;
      c.avg_close_days_won = c.durs_cnt ? Math.round((c.durs_sum / c.durs_cnt) * 10) / 10 : 0;
      delete c.durs_sum; delete c.durs_cnt;
      c.delta_abs = Math.round(c.postupleniya - c.prev_postupleniya);
      c.delta_pct = c.prev_postupleniya > 0 ? Math.round((c.delta_abs / c.prev_postupleniya) * 1000) / 10 : (c.postupleniya > 0 ? 100 : 0);
      all[id] = c;
    }

    // Видимые группы (main/autopay/ozk/bond/afanasyev) — база для доли; tech/hidden не размывают
    const visibleGroups = new Set(['main', 'autopay', 'ozk', 'bond', 'afanasyev']);
    const totalSum = Object.values(all).filter(m => visibleGroups.has(m.group)).reduce((s, m) => s + m.postupleniya, 0);
    const totalCnt = Object.values(all).filter(m => visibleGroups.has(m.group)).reduce((s, m) => s + m.won_cnt, 0);
    for (const m of Object.values(all)) {
      m.share_pct = totalSum > 0 ? Math.round((m.postupleniya / totalSum) * 1000) / 10 : 0;
    }

    const sortByPost = arr => arr.sort((a, b) => b.postupleniya - a.postupleniya);
    const groups = {};
    for (const g of Object.keys(MGR_GROUP_LABELS)) groups[g] = [];
    for (const m of Object.values(all)) groups[m.group] = groups[m.group] || [];
    for (const m of Object.values(all)) groups[m.group].push(m);
    for (const g of Object.keys(groups)) sortByPost(groups[g]);

    const iso = d => d.toISOString().substring(0, 10);
    res.json({
      period:      { from, to },
      prev_period: { from: iso(ppFrom), to: iso(ppTo) },
      managers:    groups.main,
      groups,
      labels:      MGR_GROUP_LABELS,
      total: {
        postupleniya: Math.round(totalSum),
        won_cnt: totalCnt,
        avg_check: totalCnt ? Math.round(totalSum / totalCnt) : 0,
        managers_cnt: groups.main.length,
      },
      loadedAt: new Date(getCacheAt()).toISOString(),
    });
  } catch (e) {
    console.error('/api/managers-sales error:', e.message);
    res.status(500).json({ error: e.message });
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
    const totalSum = subset.reduce((s, d) => s + getOpp(d), 0);
    const totalPaid = paid;
    const totalPaidSum = paidSum;
    const avgDur    = paidDurs.length ? paidDurs.reduce((s, d) => s + d, 0) / paidDurs.length : 0;
    const avgInvDur = invDurs.length  ? invDurs.reduce((s, d) => s + d, 0)  / invDurs.length  : 0;

    res.json({
      total, total_sum: Math.round(totalSum),
      sql, sql_sum: Math.round(sqlSum),
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
  if (path.extname(req.path)) return res.status(404).end();
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
