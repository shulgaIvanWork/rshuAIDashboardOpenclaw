/**
 * period-kpi.js — расчёт KPI за произвольный период дат (точно по дням).
 *
 * Используется управленческим дашбордом (/api/kpi?from&to):
 * KPI-карточки и донаты считаются из сделок за точный диапазон,
 * а не аппроксимируются недельными агрегатами.
 *
 * Правила принадлежности периоду:
 *  - деньги (поступления, сделки, чек, цикл) — по дате оплаты UF_DATE_PAY_1C
 *  - лиды и MQL — по дате создания DATE_CREATE
 */
import {
  MIN_OPP, VALID_CATS, MQL_SALE_STAGES, NOT_MQL_SALE, EDU_TYPE_MAP,
  isKomDeal, isInternalSource, detectFormat, detectB2b,
} from './deal-rules.js';

function parseDt(s) {
  if (!s) return null;
  const d = new Date(String(s).substring(0, 10));
  return isNaN(d) ? null : d;
}

/** Обогащение сырых сделок минимальным набором полей для KPI */
export function enrichForKpi(dealsRaw) {
  return dealsRaw.map(x => {
    const catId = parseInt(x.CATEGORY_ID || 0);
    const isKom = isKomDeal(x);
    return {
      OPP: parseFloat(x.OPPORTUNITY || 0),
      SEM: x.STAGE_SEMANTIC_ID || null,
      STAGE: x.STAGE_ID || '',
      CAT_ID: catId,
      DC: parseDt(x.DATE_CREATE),
      PAY_DT: parseDt(x.UF_DATE_PAY_1C),
      IS_KOM: isKom, IS_OOM: !isKom,
      FORMAT: detectFormat(x.TITLE || '', x.UF_FORMAT),
      EDU_TYPE: String(x.UF_CRM_1765896709800 || ''),
      BTYPE: detectB2b(x),
      IS_INTERNAL_SRC: isInternalSource(x.SOURCE_ID || ''),
    };
  });
}

function isPaid(r)    { return r.OPP >= MIN_OPP && r.PAY_DT !== null; }
// Те же правила, что в analyze.js (isAllLead / isQualLead)
function isAllLead(r) {
  if (!VALID_CATS.has(r.CAT_ID)) return false;
  if (r.SEM === 'S' && r.OPP < MIN_OPP) return false;
  return true;
}
function isQualLead(r) {
  if (!VALID_CATS.has(r.CAT_ID)) return false;
  if (r.SEM === 'S' && r.OPP < MIN_OPP) return false;
  if (r.CAT_ID === 0)  { return NOT_MQL_SALE.has(r.STAGE) ? false : MQL_SALE_STAGES.has(r.STAGE); }
  if (r.CAT_ID === 19) { return !(r.SEM === 'S' || r.SEM === 'F'); }
  return false;
}

function blockMetrics(rows, from, to, filterFn) {
  let sum = 0, cnt = 0, durSum = 0, durCnt = 0, leads = 0, mql = 0;
  let createdInPeriod = 0, paidSameAsCreated = 0;
  for (const r of rows) {
    if (filterFn && !filterFn(r)) continue;
    if (isPaid(r) && r.PAY_DT >= from && r.PAY_DT <= to) {
      sum += r.OPP; cnt++;
      if (r.DC) {
        const dd = Math.round((r.PAY_DT - r.DC) / 86400000);
        if (dd >= 0) { durSum += dd; durCnt++; }
      }
    }
    if (r.DC && r.DC >= from && r.DC <= to) {
      if (isAllLead(r))  leads++;
      if (isQualLead(r)) mql++;
      // Созданные в периоде сделки, которые тоже оплачены (по 1С) в этом же периоде
      if (VALID_CATS.has(r.CAT_ID)) {
        createdInPeriod++;
        if (isPaid(r) && r.PAY_DT >= from && r.PAY_DT <= to) paidSameAsCreated++;
      }
    }
  }
  return {
    postupleniya: Math.round(sum),
    won_relevant_cnt: cnt,
    avg_check: cnt ? Math.round(sum / cnt) : 0,
    avg_close_days_won: durCnt ? Math.round(durSum / durCnt * 10) / 10 : 0,
    leads, mql,
    created_in_period: createdInPeriod,
    paid_same_period: paidSameAsCreated,
    same_period_paid_pct: createdInPeriod ? Math.round(paidSameAsCreated / createdInPeriod * 1000) / 10 : 0,
  };
}

/** Донаты: разбивки оплаченных сделок периода */
function splits(rows, from, to) {
  const fmt = {}, edu = {}, btype = { B2B: { cnt: 0, sum: 0 }, B2C: { cnt: 0, sum: 0 } };
  const src = { internal: { cnt: 0, sum: 0 }, marketing: { cnt: 0, sum: 0 } };
  for (const r of rows) {
    if (!isPaid(r) || r.PAY_DT < from || r.PAY_DT > to) continue;
    if (!fmt[r.FORMAT]) fmt[r.FORMAT] = { cnt: 0, sum: 0 };
    fmt[r.FORMAT].cnt++; fmt[r.FORMAT].sum += r.OPP;
    const e = EDU_TYPE_MAP[r.EDU_TYPE];
    if (e) { if (!edu[e]) edu[e] = { cnt: 0, sum: 0 }; edu[e].cnt++; edu[e].sum += r.OPP; }
    if (btype[r.BTYPE]) { btype[r.BTYPE].cnt++; btype[r.BTYPE].sum += r.OPP; }
    const k = r.IS_INTERNAL_SRC ? 'internal' : 'marketing';
    src[k].cnt++; src[k].sum += r.OPP;
  }
  return { fmt, edu, btype, src };
}

/**
 * KPI за период [from, to] (Date, включительно) + разбивки.
 * rows — результат enrichForKpi().
 */
export function calcPeriodKpi(rows, from, to) {
  return {
    total: blockMetrics(rows, from, to, null),
    oom:   blockMetrics(rows, from, to, r => r.IS_OOM),
    kom:   blockMetrics(rows, from, to, r => r.IS_KOM),
    splits: splits(rows, from, to),
  };
}
