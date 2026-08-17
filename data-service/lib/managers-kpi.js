/**
 * managers-kpi.js — расчёт KPI менеджеров (перенесено из manager-report-dev/server.js
 * для единого использования: manager-report-dev и drop-dashboard /api/managers-sales).
 *
 * Логика этапов/воронки — как в manager-report (getStageRank, стадии, переходящие
 * сделки, отказы). Группы менеджеров — из mgr-groups.js (main/autopay/ozk/bond/
 * afanasyev/tech/other).
 *
 * NB: оплаты (paid/paid_sum) считаются только за отчётный год YEAR (как в
 * manager-report). Срезы (B2B/B2C, источники, форматы, тип обучения) — по суммам
 * оплаченных сделок года/периода.
 */
import { MIN_OPP, VALID_CATS, YEAR } from './deal-rules.js';
import { getMgrGroup } from './mgr-groups.js';

// ── Стадии и ранги (как в manager-report-dev) ─────────────────────────────────

function parseDT(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function cleanStage(sid) {
  return (sid || '').replace(/^C\d+:/, '');
}

const STAGE_RANK = {
  'NEW': 0, 'UC_1YW3V2': 1, 'UC_STZB49': 2, 'UC_838R2R': 3,
  'UC_4RJOR4': 4,
  'DETAILS': 5,
  'PROPOSAL': 6,
  '2': 7,
  '6': 8,
  'UC_W6SCHG': 9,
  'UC_670ME2': 10,
  'UC_F2YC3N': 11,
  'WON': 12,
};

const LOST_STAGES = new Set(['LOSE', 'UC_670ME2', 'UC_F2YC3N']);
const QUAL_STAGES = new Set(['NEW', 'UC_1YW3V2', 'UC_STZB49', 'UC_838R2R']);

function getStageRank(stage, cat, opp, hasInvoice) {
  if (cat === 8) return 0;
  if (cat === 19) {
    const KOM_RANK = {
      'NEW': 4, 'PREPARATION': 4, 'UC_ZI3P92': 4, 'UC_2F288T': 4,
      'EXECUTING': 5, 'UC_C670BC': 5, 'UC_I443UQ': 5,
      'WON': 6,
    };
    if (stage === 'LOSE' && hasInvoice) return 6;
    if (['UC_ALOZ6B', 'UC_W4ML6H'].includes(stage) && hasInvoice) return 6;
    if (stage === 'LOSE') return 4;
    return KOM_RANK[stage] ?? 4;
  }
  if (stage === 'LOSE') {
    if (hasInvoice) return 6;
    if (opp >= MIN_OPP) return 4;
    return 3;
  }
  return STAGE_RANK[stage] ?? -1;
}

const INTERNAL_SRC = ['79641902894','79641902977','79641902926','UC_7G65N9','79641902903','RECOMMENDATION'];

function isPaid(d, opp) {
  return opp >= MIN_OPP && !!d.UF_DATE_PAY_1C;
}

// Все лиды (валидные сделки) — для колонки «Лиды» (как isAllLead в analyze.js)
function isAllLead(d, opp, cat) {
  if (!VALID_CATS.has(cat)) return false;
  if (d.STAGE_SEMANTIC_ID === 'S' && opp < MIN_OPP) return false;
  return true;
}

function getMgrKey(mgrId, mgrName) {
  const g = getMgrGroup(mgrId);
  if (g === 'other')   return { key: 'Прочие', group: 'other' };
  if (g === 'autopay') return { key: 'Автооплаты', group: g };
  if (g === 'ozk')     return { key: 'ОЗК', group: g };
  return { key: mgrName, group: g };
}
export { getMgrKey };

// ── Расчёт ────────────────────────────────────────────────────────────────────

/**
 * KPI по менеджерам за период [fromDate, toDate] (Date|null).
 * fromDate/toDate = null → весь год (YEAR).
 * Возвращает массив: {name, group, in_work_start, created, na_kvalifikatsii,
 *  mql, sql, invoice_cnt, paid, paid_sum, kval_lost, nekval_lost, in_work_end,
 *  leads, avg_check, avg_dur, conv_pct, conv_lead_mql, conv_mql_sql,
 *  conv_sql_inv, conv_inv_paid, b2b_sum, b2c_sum, src_int_sum, src_mkt_sum,
 *  fmt_oom_sum, fmt_om_sum, fmt_sdo_sum, edu_pk_sum, edu_pp_sum, edu_kom_sum}
 */
export function calcManagers(deals, dicts, fromDate, toDate) {
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

  const YEAR_START = new Date(YEAR, 0, 1);

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

    let inPeriod = true;
    if (isFiltered) {
      const dcOk = dc && dc >= fromDate && dc <= toDate;
      const payOk = pay && pay >= fromDate && pay <= toDate;
      const lostOk = isLost && loseDt && loseDt >= fromDate && loseDt <= toDate;
      const wasInWork = dc && dc < fromDate && (cat === 0 || cat === 19) && !isAutoOrOzk;
      const isCarryOver = wasInWork && (!pay || pay >= fromDate) && (!isLost || !loseDt || loseDt >= fromDate);
      inPeriod = dcOk || payOk || lostOk || isCarryOver;
      if (!inPeriod) continue;
    }

    const m = getMgr(key);
    if (group !== 'hidden') m.group = group;

    const periodStart = isFiltered ? fromDate : YEAR_START;
    if (dc && dc <= periodStart && (cat === 0 || cat === 19) && !isAutoOrOzk) {
      const wasPaid = pay && pay <= periodStart;
      const wasLost = isLost && (loseDt ? loseDt <= periodStart : true);
      if (!wasPaid && !wasLost) m.in_work_start++;
    }

    const inFunnel = (!isAutoOrOzk || opp >= MIN_OPP);
    if (!inFunnel) continue;

    const rank = getStageRank(stage, cat, opp, hasInvoice);
    const isWonDub = stage === 'WON' && (cat === 8 || cat === 19);

    if (!isWonDub) m.created++;

    if (cat === 8 && sem !== 'S' && sem !== 'F') {
      m.na_kvalifikatsii++;
    } else if (cat === 0 && QUAL_STAGES.has(stage)) {
      m.na_kvalifikatsii++;
    }

    if (rank >= 4) m.mql++;
    if (rank >= 5) m.sql++;
    if (rank >= 6 && hasInvoice) m.invoice_cnt++;

    if (isAllLead(d, opp, cat)) m.leads++;

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

    if (isLost) {
      const lostInYear = loseDt ? loseDt.getFullYear() === YEAR : false;
      const lostInPeriod = !isFiltered || (loseDt && loseDt >= fromDate && loseDt <= toDate);
      if (lostInYear && lostInPeriod) {
        if (cat === 19 || rank >= 4) m.kval_lost++;
        else m.nekval_lost++;
      }
    }
  }

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
