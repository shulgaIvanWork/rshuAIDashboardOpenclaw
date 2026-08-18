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
import { isKomDeal, isInternalSource, MIN_OPP, REG_SRC_ID, VALID_CATS, MQL_SALE_STAGES, NOT_MQL_SALE, YEAR } from '@rshu/data-service/lib/deal-rules.js';
import { enrichForKpi, calcPeriodKpi } from '@rshu/data-service/lib/period-kpi.js';
// Единый справочник групп менеджеров
import { getMgrGroup, MGR_GROUP_LABELS } from '@rshu/data-service/lib/mgr-groups.js';
// Полный расчёт KPI по менеджерам (Таблица 1/2, срезы) — общий с manager-report
import { calcManagers } from '@rshu/data-service/lib/managers-kpi.js';

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

// Полный отчёт по менеджерам за период (Таблица 1: показатели, Таблица 2: конверсии,
// срезы B2B/B2C·источники·форматы). Расчёт — общий calcManagers (managers-kpi.js),
// группы — mgr-groups.js. Менеджеры уже агрегированы (индивид. + Автооплаты/ОЗК/Прочие).
app.get('/api/managers-report', async (req, res) => {
  try {
    const { from, to } = req.query;
    // Фильтры: форма обучения (all|oom|kom) и трафик (all|internal|market).
    // Фильтруем ВХОДНЫЕ сделки до calcManagers — метрики пересчитываются по подвыборке.
    const form    = String(req.query.form || 'all');
    const traffic = String(req.query.traffic || 'all');
    const [dealsAll, dicts] = await Promise.all([
      fs.readFile(DEALS_PATH, 'utf-8').then(JSON.parse),
      fs.readFile(path.join(__dirname, '..', '..', 'data-service', 'cache', 'dicts.json'), 'utf-8').then(JSON.parse),
    ]);
    let fromDate = null, toDate = null;
    if (from && to) {
      fromDate = new Date(from + 'T00:00:00');
      toDate   = new Date(to   + 'T23:59:59');
      if (isNaN(fromDate) || isNaN(toDate) || fromDate > toDate) {
        return res.status(400).json({ error: 'некорректный диапазон дат' });
      }
    }
    const dealsRaw = dealsAll.filter(d => {
      if (form === 'oom' && isKomDeal(d)) return false;         // открытое обучение = не КОМ
      if (form === 'kom' && !isKomDeal(d)) return false;        // корпоративное обучение = КОМ
      const internal = isInternalSource(d.SOURCE_ID);
      if (traffic === 'internal' && !internal) return false;    // внутренняя база
      if (traffic === 'market'   &&  internal) return false;    // маркетинговый трафик
      return true;
    });
    const all = calcManagers(dealsRaw, dicts, fromDate, toDate);
    const g = k => all.filter(m => m.group === k);
    res.json({
      period:   (from && to) ? `${from} — ${to}` : 'YTD',
      managers: [...g('main'), ...g('autopay'), ...g('ozk'), ...g('other'), ...g('tech')],
      loadedAt: new Date(getCacheAt()).toISOString(),
    });
  } catch (e) {
    console.error('/api/managers-report error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Недельная/месячная динамика для ОДНОГО менеджера (или всех при mgr=all).
// Метрики и бакетирование — 1:1 как в analyze.js (leads/mql/sql по дате создания,
// счёт по дате счёта, оплаты по дате оплаты). Мета недель/месяцев берём из getAgg,
// чтобы подписи и порядок точно совпадали с таблицей «Все». Данные — за весь YEAR.
app.get('/api/manager-weeks', async (req, res) => {
  try {
    const mgrId = String(req.query.mgr || '');
    if (!mgrId) return res.status(400).json({ error: 'mgr обязателен (id или all)' });
    const filterAll = mgrId === 'all';
    const [dealsRaw, agg] = await Promise.all([
      fs.readFile(DEALS_PATH, 'utf-8').then(JSON.parse),
      getAgg(),
    ]);

    const parseDt = s => {
      if (!s) return null;
      let m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return new Date(+m[1], +m[2]-1, +m[3]);
      m = String(s).match(/^(\d{2})\.(\d{2})\.(\d{4})/); if (m) return new Date(+m[3], +m[2]-1, +m[1]);
      return null;
    };
    const dateOnly = d => d ? new Date(d.getFullYear(), d.getMonth(), d.getDate()) : null;
    const isoWeek = d => { const l = dateOnly(d); const dow = l.getDay() || 7; const thu = new Date(l); thu.setDate(l.getDate() + 4 - dow); const yr = thu.getFullYear(); return Math.floor((thu - new Date(yr, 0, 1)) / (7*86400000)) + 1; };
    const daysBetween = (a, b) => Math.round((dateOnly(b) - dateOnly(a)) / 86400000);

    const isAllLead  = r => VALID_CATS.has(r.CAT_ID) && !(r.SEM === 'S' && r.OPP < MIN_OPP);
    const isQualLead = r => {
      if (!VALID_CATS.has(r.CAT_ID)) return false;
      if (r.SEM === 'S' && r.OPP < MIN_OPP) return false;
      if (r.CAT_ID === 0)  return NOT_MQL_SALE.has(r.STAGE) ? false : MQL_SALE_STAGES.has(r.STAGE);
      if (r.CAT_ID === 19) return !(r.SEM === 'S' || r.SEM === 'F');
      return false;
    };
    const isSqlByCreate = r => {
      const st = r.STAGE;
      if (['DETAILS','PROPOSAL','2','6','WON'].includes(st)) return true;
      if (r.CAT_ID === 19 && r.SEM !== 'S') {
        const ks = (st || '').replace('C19:', '');
        if (['EXECUTING','UC_C670BC','UC_I443UQ'].includes(ks)) return true;
        if (r.UF5 && ['UC_ALOZ6B','UC_W4ML6H','LOSE'].includes(ks)) return true;
      }
      if (r.INV && ['LOSE','UC_F2YC3N','UC_W6SCHG','UC_670ME2','UC_VKPN0N'].includes(st)) return true;
      return false;
    };

    const wk = {}, mo = {};
    const blank = () => ({ leads:0, mql:0, sql:0, invoice_cnt:0, oplata:0, postupleniya:0, won_cnt:0, durSum:0, durN:0 });
    const eW = k => (wk[k] || (wk[k] = blank()));
    const eM = k => (mo[k] || (mo[k] = blank()));

    for (const x of dealsRaw) {
      if (!filterAll && String(x.ASSIGNED_BY_ID || '') !== mgrId) continue;
      const r = {
        OPP: parseFloat(x.OPPORTUNITY || 0), SEM: x.STAGE_SEMANTIC_ID || null,
        STAGE: x.STAGE_ID || '', CAT_ID: parseInt(x.CATEGORY_ID || 0),
        DC: parseDt(x.DATE_CREATE), PAY_DT: parseDt(x.UF_DATE_PAY_1C),
        INV_DT: parseDt(x.UF_CRM_1753272713011), INV: x.UF_CRM_1753272713011,
        UF5: x.UF_CRM_5D133690E1, IS_KOM: isKomDeal(x),
      };
      // leads/mql/sql — по дате создания
      if (r.DC && r.DC.getFullYear() === YEAR) {
        const w = isoWeek(r.DC), mm = r.DC.getMonth();
        if (isAllLead(r))     { eW(w).leads++;  eM(mm).leads++; }
        if (isQualLead(r))    { eW(w).mql++;    eM(mm).mql++; }
        if (isSqlByCreate(r)) { eW(w).sql++;    eM(mm).sql++; }
      }
      // счёт — по дате счёта
      if (r.INV_DT && r.INV_DT.getFullYear() === YEAR) {
        eW(isoWeek(r.INV_DT)).invoice_cnt++; eM(r.INV_DT.getMonth()).invoice_cnt++;
      }
      // оплаты — по дате оплаты
      if (r.OPP >= MIN_OPP && r.PAY_DT && r.PAY_DT.getFullYear() === YEAR && VALID_CATS.has(r.CAT_ID)) {
        const w = isoWeek(r.PAY_DT), mm = r.PAY_DT.getMonth();
        eW(w).oplata++; eW(w).postupleniya += r.OPP;
        eM(mm).oplata++; eM(mm).postupleniya += r.OPP;
        if (!r.IS_KOM) { eW(w).won_cnt++; eM(mm).won_cnt++; }
        if (r.DC) { const dd = daysBetween(r.DC, r.PAY_DT); if (dd >= 0) { eW(w).durSum += dd; eW(w).durN++; eM(mm).durSum += dd; eM(mm).durN++; } }
      }
    }

    const finalize = (metaArr, store, keyFn) => (metaArr || []).map(meta => {
      const b = store[keyFn(meta)] || blank();
      const post = b.postupleniya || 0, opl = b.oplata || 0, won = b.won_cnt || 0;
      return {
        week: meta.week, month: meta.month, label_dates: meta.label_dates,
        leads: b.leads, mql: b.mql, sql: b.sql, invoice_cnt: b.invoice_cnt,
        oplata: opl, postupleniya: post,
        avg_check: won ? post / won : 0,
        avg_dur: b.durN ? b.durSum / b.durN : 0,
        conv_lead_mql:       b.leads ? b.mql / b.leads * 100 : 0,
        conv_mql_sql:        b.mql   ? b.sql / b.mql * 100 : 0,
        conv_sql_invoice:    b.sql   ? b.invoice_cnt / b.sql * 100 : 0,
        conv_invoice_oplata: b.invoice_cnt ? opl / b.invoice_cnt * 100 : 0,
      };
    });

    res.json({
      mgr:      mgrId,
      weeks:    finalize(agg.weeks,  wk, m => m.week),
      months:   finalize(agg.months, mo, m => (m.month != null ? m.month - 1 : m.week - 1)),
      loadedAt: new Date(getCacheAt()).toISOString(),
    });
  } catch (e) {
    console.error('/api/manager-weeks error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Дневная динамика поступлений (ООМ/КОМ) за YEAR — для режима «Дни» блока «Поступления».
// Бакетируем по дате оплаты, непрерывный ряд от 1 января до сегодня (дни без оплат = 0).
app.get('/api/day-series', async (req, res) => {
  try {
    const dealsRaw = JSON.parse(await fs.readFile(DEALS_PATH, 'utf-8'));
    const parseDt = s => {
      if (!s) return null;
      let m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return new Date(+m[1], +m[2]-1, +m[3]);
      m = String(s).match(/^(\d{2})\.(\d{2})\.(\d{4})/); if (m) return new Date(+m[3], +m[2]-1, +m[1]);
      return null;
    };
    const key = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const bucket = {};
    for (const x of dealsRaw) {
      const opp = parseFloat(x.OPPORTUNITY || 0);
      if (opp < MIN_OPP) continue;
      const pd = parseDt(x.UF_DATE_PAY_1C);
      if (!pd || pd.getFullYear() !== YEAR) continue;
      if (!VALID_CATS.has(parseInt(x.CATEGORY_ID || 0))) continue;
      const b = bucket[key(pd)] || (bucket[key(pd)] = { oom_postupleniya: 0, kom_postupleniya: 0 });
      if (isKomDeal(x)) b.kom_postupleniya += opp; else b.oom_postupleniya += opp;
    }
    const today = new Date();
    const end = today.getFullYear() === YEAR ? new Date(YEAR, today.getMonth(), today.getDate()) : new Date(YEAR, 11, 31);
    const days = [];
    for (let dt = new Date(YEAR, 0, 1); dt <= end; dt.setDate(dt.getDate() + 1)) {
      const b = bucket[key(dt)] || { oom_postupleniya: 0, kom_postupleniya: 0 };
      days.push({
        label_dates: `${String(dt.getDate()).padStart(2,'0')}.${String(dt.getMonth()+1).padStart(2,'0')}`,
        oom_postupleniya: b.oom_postupleniya, kom_postupleniya: b.kom_postupleniya,
      });
    }
    res.json({ days, loadedAt: new Date(getCacheAt()).toISOString() });
  } catch (e) {
    console.error('/api/day-series error:', e.message);
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
