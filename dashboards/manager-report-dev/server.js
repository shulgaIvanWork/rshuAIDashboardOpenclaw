import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MY_CACHE = path.resolve(__dirname, 'cache');
const router = express.Router();

let aggCache = null;
let dealsCache = null;
let dictsCache = null;

function parseDT(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// Очищает STAGE_ID от префикса категории (C0:, C19:, C8:) — export API
function cleanStage(sid) {
  return (sid || '').replace(/^C\d+:/, '');
}

// === Логика analyze_new.py на JS (только для менеджеров) ===
const MIN_OPP = 11;
const VALID_CATS = new Set([0, 8, 19]);
const YEAR = 2026;

// Группы менеджеров (тот же словарь, что в analyze_new.py)
const MGR_GROUPS = {
  '1': 'bond', '513': 'main', '527': 'autopay', '516': 'autopay',
  '528': 'main', '12482': 'main', '20588': 'hidden',
  '21286': 'afanasyev', '27015': 'main', '19823': 'tech',
  '26192': 'hidden', '27163': 'main', '27119': 'tech',
  '26343': 'hidden', '26161': 'hidden', '27158': 'main',
  '27157': 'hidden', '586': 'tech', '515': 'hidden',
  '517': 'hidden', '23840': 'hidden', '23715': 'hidden',
  '23251': 'hidden', '25557': 'hidden', '24984': 'hidden',
  '24620': 'hidden', '23296': 'hidden', '24688': 'hidden',
  '5274': 'tech', '22275': 'tech', '25474': 'hidden',
};

const INTERNAL_SRC = ['79641902894','79641902977','79641902926','UC_7G65N9','79641902903','RECOMMENDATION'];

function isPaid(d, opp) {
  return opp >= MIN_OPP && !!d.UF_DATE_PAY_1C;
}

function isPaidNoMin(d) {
  return !!d.UF_DATE_PAY_1C;
}

function getGroup(mgrId) {
  return MGR_GROUPS[mgrId] || 'hidden';
}

function getMgrKey(mgrId, mgrName) {
  const g = getGroup(mgrId);
  if (g === 'hidden') return { key: 'Прочие', group: 'other' };
  if (g === 'autopay') return { key: 'Автооплаты', group: g };
  return { key: mgrName, group: g };
}

// Рассчитать метрики для менеджеров за период (YTD если from/to не заданы)
function calcManagers(deals, dicts, fromDate, toDate) {
  const users = dicts?.users || {};
  const mgrData = {};
  const isFiltered = fromDate && toDate;

  function getMgr(name) {
    if (!mgrData[name]) {
      mgrData[name] = {
        name, in_work_start: 0, created: 0, paid: 0, paid_sum: 0,
        lost: 0, leads: 0, mql: 0, sql: 0, invoice_cnt: 0,
        group: '', b2b_sum: 0, b2c_sum: 0,
        src_int_sum: 0, src_mkt_sum: 0,
        fmt_oom_sum: 0, fmt_om_sum: 0, fmt_sdo_sum: 0,
        edu_pk_sum: 0, edu_pp_sum: 0, edu_kom_sum: 0,
        durs_sum: 0, durs_cnt: 0,
      };
    }
    return mgrData[name];
  }

  const YEAR_START = new Date(2026, 0, 1);

  for (const d of deals) {
    const cat = parseInt(d.CATEGORY_ID) || 0;
    if (!VALID_CATS.has(cat)) continue;
    const opp = parseFloat(d.OPPORTUNITY) || 0;
    const mgrId = String(d.ASSIGNED_BY_ID || '');
    const mgrName = users[mgrId] || mgrId;
    const { key, group } = getMgrKey(mgrId, mgrName);
    if (group === 'hidden' && !isFiltered) continue;
    const dc = parseDT(d.DATE_CREATE);
    const pay = parseDT(d.UF_DATE_PAY_1C);
    const cl = parseDT(d.CLOSEDATE);
    const sem = d.STAGE_SEMANTIC_ID || '';
    const stage = cleanStage(d.STAGE_ID);

    let inPeriod = true;
    if (isFiltered) {
      const dcOk = dc && dc >= fromDate && dc <= toDate;
      const payOk = pay && pay >= fromDate && pay <= toDate;
      const lostOk = sem === 'F' && cl && cl >= fromDate && cl <= toDate;
      inPeriod = dcOk || payOk || lostOk;
      if (!inPeriod) continue;
    }

    const m = getMgr(key);
    if (group !== 'hidden') m.group = group;

    // in_work_start — сделки в работе на начало периода (для любого периода)
    const periodStart = isFiltered ? fromDate : YEAR_START;
    if (dc && dc <= periodStart) {
      const wasPaid = pay && pay < periodStart;
      const wasLost = sem === 'F' && cl && cl < periodStart;
      if (!wasPaid && !wasLost) {
        m.in_work_start++;
      }
    }

    // created
    if (dc && dc.getFullYear() === YEAR) {
      if (!isFiltered || (dc >= fromDate && dc <= toDate)) {
        m.created++;
      }
    }

    // paid
    const isP = isPaid(d, opp);
    if (isP && pay.getFullYear() === YEAR) {
      if (!isFiltered || (pay >= fromDate && pay <= toDate)) {
        m.paid++;
        m.paid_sum += opp;
        if (dc && pay) {
          const dur = Math.round((pay - dc) / (1000*60*60*24));
          if (dur >= 0) { m.durs_sum += dur; m.durs_cnt++; }
        }
        // slices
        // B2B/B2C — по COMPANY_ID
        const companyId = String(d.COMPANY_ID || d['UF_CRM_1455718982'] || '0');
        if (companyId !== '0' && companyId !== 'null') m.b2b_sum += opp;
        else m.b2c_sum += opp;
        // источники
        const srcId = String(d.SOURCE_ID || '');
        if (INTERNAL_SRC.includes(srcId)) m.src_int_sum += opp;
        else m.src_mkt_sum += opp;
        // форматы
        const fmt = String(d.UF_FORMAT || '');
        if (fmt === '19042467') m.fmt_oom_sum += opp;
        else if (fmt === '19042468') m.fmt_om_sum += opp;
        else if (fmt === '19042469') m.fmt_sdo_sum += opp;
        // тип обучения
        const edu = String(d.UF_CRM_1765896709800 || '');
        if (edu === '34699') m.edu_pk_sum += opp;
        else if (edu === '34700') m.edu_pp_sum += opp;
        else if (edu === '34765') m.edu_kom_sum += opp;
      }
    }

    // lost — только за 2026 год (YEAR) или за выбранный период
    if (sem === 'F') {
      const lostYear = cl ? cl.getFullYear() : 0;
      if (!isFiltered && lostYear === YEAR) {
        m.lost++;
      } else if (isFiltered && cl && cl >= fromDate && cl <= toDate) {
        m.lost++;
      }
    }

    // MQL — по is_qual_lead
    if (dc && dc.getFullYear() === YEAR) {
      let isMql = false;
      if (cat === 0) {
        if (!['NEW', 'UC_1YW3V2', 'UC_STZB49', 'UC_838R2R'].includes(stage)) isMql = true;
      } else if (cat === 19) {
        if (sem !== 'S' && sem !== 'F') isMql = true;
      }
      if (isMql && (!isFiltered || (dc >= fromDate && dc <= toDate))) {
        m.mql++;
      }
    }

    // SQL
    if (dc && dc.getFullYear() === YEAR) {
      const hasInvoice = d.UF_CRM_1753272713011;
      let isSql = false;
      if (['DETAILS', 'PROPOSAL', '2', '6', 'WON'].includes(stage)) {
        isSql = true;
      } else if (cat === 19 && sem !== 'S') {
        if (['EXECUTING', 'UC_C670BC', 'UC_I443UQ'].includes(stage)) isSql = true;
        else if (hasInvoice && ['LOSE', 'UC_ALOZ6B', 'UC_W4ML6H'].includes(stage)) isSql = true;
      } else if (hasInvoice && ['LOSE', 'UC_F2YC3N', 'UC_W6SCHG', 'UC_670ME2', 'UC_VKPN0N'].includes(stage)) {
        isSql = true;
      }
      if (isSql && (!isFiltered || (dc >= fromDate && dc <= toDate))) {
        m.sql++;
      }
    }

    // invoice
    const invDt = parseDT(d.UF_CRM_1753272713011);
    if (invDt && invDt.getFullYear() === YEAR && sem !== 'F') {
      if (!isFiltered || (invDt >= fromDate && invDt <= toDate)) {
        m.invoice_cnt++;
      }
    }
  }

  // Конвертируем в массив + считаем произвольные поля
  const result = Object.values(mgrData).map(m => {
    const iwe = m.in_work_start + m.created - m.paid - m.lost;
    const avgCheck = m.paid ? Math.round(m.paid_sum / m.paid) : 0;
    const avgDur = m.durs_cnt ? Math.round(m.durs_sum / m.durs_cnt * 10) / 10 : 0;
    const conv = (m.paid + m.lost) ? Math.round(m.paid / (m.paid + m.lost) * 1000) / 10 : 0;

    const cl = m.mql ? Math.round(m.mql / (m.leads || 1) * 1000) / 10 : 0;
    const cs = m.mql ? Math.round(m.sql / m.mql * 1000) / 10 : 0;
    const ci = m.sql ? Math.round(m.invoice_cnt / m.sql * 1000) / 10 : 0;
    const cp = m.invoice_cnt ? Math.round(m.paid / m.invoice_cnt * 1000) / 10 : 0;

    return {
      name: m.name, group: m.group || 'main',
      in_work_start: m.in_work_start, created: m.created,
      paid: m.paid, paid_sum: Math.round(m.paid_sum), lost: m.lost,
      in_work_end: Math.max(0, iwe),
      leads: m.leads, mql: m.mql, sql: m.sql, invoice_cnt: m.invoice_cnt,
      avg_check: avgCheck, avg_dur: avgDur, conv_pct: conv,
      conv_lead_mql: cl, conv_mql_sql: cs, conv_sql_inv: ci, conv_inv_paid: cp,
      b2b_sum: Math.round(m.b2b_sum), b2c_sum: Math.round(m.b2c_sum),
      src_int_sum: Math.round(m.src_int_sum), src_mkt_sum: Math.round(m.src_mkt_sum),
      fmt_oom_sum: Math.round(m.fmt_oom_sum), fmt_om_sum: Math.round(m.fmt_om_sum), fmt_sdo_sum: Math.round(m.fmt_sdo_sum),
      edu_pk_sum: Math.round(m.edu_pk_sum), edu_pp_sum: Math.round(m.edu_pp_sum), edu_kom_sum: Math.round(m.edu_kom_sum),
    };
  });

  result.sort((a, b) => (b.paid_sum || (b.group === 'main' ? 1 : 0)) - (a.paid_sum || (a.group === 'main' ? 1 : 0)));
  return result;
}

// Загрузка кэша
async function loadCache() {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(MY_CACHE, 'agg.json'), 'utf-8'));
    aggCache = raw;
    dealsCache = JSON.parse(await fs.readFile(path.join(MY_CACHE, 'deals_NEW.json'), 'utf-8'));
    dictsCache = JSON.parse(await fs.readFile(path.join(MY_CACHE, 'dicts.json'), 'utf-8'));
    console.log(`[manager-report-dev] Cache: ${aggCache.mgr_top?.length || 0} managers, ${dealsCache.length} deals`);
  } catch (e) {
    console.log('[manager-report-dev] Cache error:', e.message);
  }
}

router.use(express.static(path.join(__dirname, 'public')));

// API: manager data (с поддержкой фильтра по периоду)
router.get('/api/managers', (req, res) => {
  if (!aggCache || !dealsCache) return res.json({ error: 'Нет данных' });

  const from = req.query.from;
  const to = req.query.to;
  let fromDate = null, toDate = null;
  let periodLabel = 'YTD';

  if (from && to) {
    fromDate = new Date(from + 'T00:00:00');
    toDate = new Date(to + 'T23:59:59');
    periodLabel = `${from} — ${to}`;
  }

  const all = calcManagers(dealsCache, dictsCache, fromDate, toDate);

  const groups = {
    main: all.filter(m => m.group === 'main'),
    autopay: all.filter(m => m.group === 'autopay'),
    other: all.filter(m => m.group === 'other'),
    tech: all.filter(m => m.group === 'tech'),
    bond: all.filter(m => m.group === 'bond'),
    afanasyev: all.filter(m => m.group === 'afanasyev'),
  };

  res.json({
    managers: [...groups.main, ...groups.autopay, ...groups.other, ...groups.tech],
    managersBond: groups.bond,
    managersAfanasyev: groups.afanasyev,
    managersTech: groups.tech,
    groups,
    period: periodLabel,
    ytd: aggCache.ytd,
    weeks: aggCache.weeks,
    fmt_ytd: aggCache.fmt_ytd,
    loadedAt: aggCache.today,
  });
});

router.get('/api/funnel', async (req, res) => {
  try {
    const data = JSON.parse(await fs.readFile(path.join(MY_CACHE, 'agg.json'), 'utf-8'));
    const weeks = (data.weeks || []).map(function(w) {
      return {
        label_dates: w.label_dates,
        week: w.week,
        stack_rej_nq: w.stack_rej_nq || 0, stack_rej: w.stack_rej || 0,
        stack_nq: w.stack_nq || 0, stack_mql: w.stack_mql || 0,
        stack_sql: w.stack_sql || 0, stack_inv: w.stack_inv || 0,
        stack_pay: w.stack_pay || 0
      };
    });
    res.json({ weeks });
  } catch (e) {
    res.json({ weeks: [] });
  }
});

router.get('/api/status', (req, res) => {
  res.json({
    ready: !!aggCache,
    managers: aggCache?.mgr_top?.length || 0,
    deals: dealsCache?.length || 0,
  });
});

router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

loadCache();

export default router;
