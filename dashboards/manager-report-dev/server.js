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

function cleanStage(sid) {
  return (sid || '').replace(/^C\d+:/, '');
}

const MIN_OPP = 11;
const VALID_CATS = new Set([0, 8, 19]);
const YEAR = 2026;

// Ранги стадий для последовательной воронки (кат 0)
const STAGE_RANK = {
  'NEW': 0, 'UC_1YW3V2': 1, 'UC_STZB49': 2, 'UC_838R2R': 3,
  'UC_4RJOR4': 4, // MQL
  'DETAILS': 5, // SQL
  'PROPOSAL': 6, // Счёт отправлен
  '2': 7, // Постоплата
  '6': 8, // Частично оплачен
  'UC_W6SCHG': 9, // Следующий год
  'UC_670ME2': 10, // Возвращен в работу (отказ)
  'UC_F2YC3N': 11, // Предзакрытие в отказ
  'WON': 12, // Счёт оплачен
};

// Все стадии отказа
const LOST_STAGES = new Set(['LOSE', 'UC_670ME2', 'UC_F2YC3N']);
// Стадии квалификации (Sale)
const QUAL_STAGES = new Set(['NEW', 'UC_1YW3V2', 'UC_STZB49', 'UC_838R2R']);

function getStageRank(stage, cat, opp, hasInvoice) {
  // PreSale — базовая
  if (cat === 8) return 0;
  
  // КОМ (кат 19): ранги по стадиям
  if (cat === 19) {
    const KOM_RANK = {
      'NEW': 4, 'PREPARATION': 4, 'UC_ZI3P92': 4, 'UC_2F288T': 4,
      'EXECUTING': 5, 'UC_C670BC': 5, 'UC_I443UQ': 5,
      'WON': 6,
    };
    // Для LOSE/UC_ALOZ6B/UC_W4ML6H: если есть invoice → ранк 6, иначе 4
    if (stage === 'LOSE' && hasInvoice) return 6;
    if (['UC_ALOZ6B', 'UC_W4ML6H'].includes(stage) && hasInvoice) return 6;
    if (stage === 'LOSE') return 4;
    return KOM_RANK[stage] ?? 4;
  }
  
  // Sale (кат 0)
  if (stage === 'LOSE') {
    if (hasInvoice) return 6;
    if (opp >= MIN_OPP) return 4;
    return 3;
  }
  return STAGE_RANK[stage] ?? -1;
}

const MGR_GROUPS = {
  '1': 'bond', '513': 'main', '527': 'autopay', '516': 'autopay',
  '528': 'main', '12482': 'main', '20588': 'hidden',
  '21286': 'afanasyev', '27015': 'main', '19823': 'ozk',
  '26192': 'hidden', '27163': 'main', '27119': 'ozk',
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

function getGroup(mgrId) {
  return MGR_GROUPS[mgrId] || 'hidden';
}

function getMgrKey(mgrId, mgrName) {
  const g = getGroup(mgrId);
  if (g === 'hidden') return { key: 'Прочие', group: 'other' };
  if (g === 'autopay') return { key: 'Автооплаты', group: g };
  if (g === 'ozk') return { key: 'ОЗК', group: g };
  return { key: mgrName, group: g };
}

// === Новая последовательная воронка ===
function calcManagers(deals, dicts, fromDate, toDate) {
  const users = dicts?.users || {};
  const mgrData = {};
  const isFiltered = fromDate && toDate;

  function getMgr(name) {
    if (!mgrData[name]) {
      mgrData[name] = {
        name, in_work_start: 0, created: 0,
        na_kvalifikatsii: 0, mql: 0, sql: 0, invoice_cnt: 0,
        paid: 0, paid_sum: 0,
        kval_lost: 0, nekval_lost: 0,
        leads: 0, group: '',
        b2b_sum: 0, b2c_sum: 0,
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
    const isAutoOrOzk = group === 'autopay' || group === 'ozk';
    const dc = parseDT(d.DATE_CREATE);
    const pay = parseDT(d.UF_DATE_PAY_1C);
    const cl = parseDT(d.CLOSEDATE);
    const loseDt = parseDT(d.UF_CRM_1753341391806) || cl;
    const sem = d.STAGE_SEMANTIC_ID || '';
    const stage = cleanStage(d.STAGE_ID);
    const hasInvoice = !!d.UF_CRM_1753272713011;
    const isLost = LOST_STAGES.has(stage);

    // Фильтр периода
    let inPeriod = true;
    if (isFiltered) {
      const dcOk = dc && dc >= fromDate && dc <= toDate;
      const payOk = pay && pay >= fromDate && pay <= toDate;
      const lostOk = isLost && loseDt && loseDt >= fromDate && loseDt <= toDate;
      inPeriod = dcOk || payOk || lostOk;
      if (!inPeriod) continue;
    }

    const m = getMgr(key);
    if (group !== 'hidden') m.group = group;

    // === in_work_start ===
    const periodStart = isFiltered ? fromDate : YEAR_START;
    if (dc && dc <= periodStart && (cat === 0 || cat === 19) && !isAutoOrOzk) {
      const wasPaid = pay && pay <= periodStart;
      const wasLost = isLost && (loseDt ? loseDt <= periodStart : true);
      if (!wasPaid && !wasLost) {
        m.in_work_start++;
      }
    }

    // Условие для воронки: создана в 2026 / в периоде
    const inYear = dc && dc.getFullYear() === YEAR;
    const inPeriodByDc = !isFiltered || (dc >= fromDate && dc <= toDate);
    const inFunnel = inYear && inPeriodByDc && (!isAutoOrOzk || opp >= MIN_OPP);
    if (!inFunnel) continue;

    const rank = getStageRank(stage, cat, opp, hasInvoice);

    // === 1. Создано (без дублей WON в КОМ и PreSale) ===
    if (!(stage === 'WON' && (cat === 8 || cat === 19))) {
      m.created++;
    }

    // === 2. На квалификации ===
    if (cat === 8 && sem !== 'S' && sem !== 'F') {
      m.na_kvalifikatsii++;
    } else if (cat === 0 && QUAL_STAGES.has(stage)) {
      m.na_kvalifikatsii++;
    }

    // === 3. MQL (прошли MQL+, включая ушедших в отказ после MQL) ===
    if (rank >= 4) {
      m.mql++;
    }

    // === 4. SQL (прошли SQL+, включая ушедших в отказ после SQL) ===
    if (rank >= 5) {
      m.sql++;
    }

    // === 5. Счёт отправлен (PROPOSAL+ с датой счёта, включая ушедших в отказ после) ===
    if (rank >= 6 && hasInvoice) {
      m.invoice_cnt++;
    }

    // === 6. Оплачено ===
    const isP = isPaid(d, opp);
    if (isP && pay.getFullYear() === YEAR) {
      if (!isFiltered || (pay >= fromDate && pay <= toDate)) {
        m.paid++;
        m.paid_sum += opp;
        if (dc && pay) {
          const dur = Math.round((pay - dc) / (1000*60*60*24));
          if (dur >= 0) { m.durs_sum += dur; m.durs_cnt++; }
        }
        const companyId = String(d.COMPANY_ID || d['UF_CRM_1455718982'] || '0');
        if (companyId !== '0' && companyId !== 'null') m.b2b_sum += opp;
        else m.b2c_sum += opp;
        const srcId = String(d.SOURCE_ID || '');
        if (INTERNAL_SRC.includes(srcId)) m.src_int_sum += opp;
        else m.src_mkt_sum += opp;
        const fmt = String(d.UF_FORMAT || '');
        if (fmt === '19042467') m.fmt_oom_sum += opp;
        else if (fmt === '19042468') m.fmt_om_sum += opp;
        else if (fmt === '19042469') m.fmt_sdo_sum += opp;
        const edu = String(d.UF_CRM_1765896709800 || '');
        if (edu === '34699') m.edu_pk_sum += opp;
        else if (edu === '34700') m.edu_pp_sum += opp;
        else if (edu === '34765') m.edu_kom_sum += opp;
      }
    }

    // === 7. Квал отказы / Не квал отказы ===
    if (isLost) {
      const lostInYear = loseDt ? loseDt.getFullYear() === YEAR : false;
      const lostInPeriod = !isFiltered || (loseDt && loseDt >= fromDate && loseDt <= toDate);
      if (lostInYear && lostInPeriod) {
        if (cat === 19 || rank >= 4) {
          m.kval_lost++;  // прошли MQL+ или КОМ
        } else {
          m.nekval_lost++;  // PreSale или Sale с рангом <4
        }
      }
    }
  }

  // === Результат ===
  const result = Object.values(mgrData).map(m => {
    const iwe = m.in_work_start + m.created - m.paid - m.kval_lost - m.nekval_lost;
    const avgCheck = m.paid ? Math.round(m.paid_sum / m.paid) : 0;
    const avgDur = m.durs_cnt ? Math.round(m.durs_sum / m.durs_cnt * 10) / 10 : 0;
    const allLost = m.kval_lost + m.nekval_lost;
    const conv = (m.paid + allLost) ? Math.round(m.paid / (m.paid + allLost) * 1000) / 10 : 0;
    const cl = m.created ? Math.round(m.mql / m.created * 1000) / 10 : 0;
    const cs = m.mql ? Math.round(m.sql / m.mql * 1000) / 10 : 0;
    const ci = m.sql ? Math.round(m.invoice_cnt / m.sql * 1000) / 10 : 0;
    const cp = m.invoice_cnt ? Math.round(m.paid / m.invoice_cnt * 1000) / 10 : 0;

    return {
      name: m.name, group: m.group || 'main',
      in_work_start: m.in_work_start, created: m.created,
      na_kvalifikatsii: m.na_kvalifikatsii,
      mql: m.mql, sql: m.sql, invoice_cnt: m.invoice_cnt,
      paid: m.paid, paid_sum: Math.round(m.paid_sum),
      kval_lost: m.kval_lost, nekval_lost: m.nekval_lost,
      in_work_end: Math.max(0, iwe),
      leads: m.leads,
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

// === Загрузка кэша ===
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
    ozk: all.filter(m => m.group === 'ozk'),
    other: all.filter(m => m.group === 'other'),
    tech: all.filter(m => m.group === 'tech'),
    bond: all.filter(m => m.group === 'bond'),
    afanasyev: all.filter(m => m.group === 'afanasyev'),
  };

  res.json({
    managers: [...groups.main, ...groups.autopay, ...groups.ozk, ...groups.other, ...groups.tech],
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
        label_dates: w.label_dates, week: w.week,
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
