/**
 * analyze.js — вычисляет все агрегированные метрики по сделкам.
 *
 * ВХОДНЫЕ ДАННЫЕ (читает из cache/):
 *   deals.json     — массив всех сделок из Б24 (28 000+ записей)
 *   dicts.json     — справочники: categories, users, sources, formats, directions
 *   fetched_at.json — время последней выгрузки из Б24 (для отображения актуальности)
 *
 * ЧТО СЧИТАЕТ:
 *   - YTD-метрики (поступления, лиды, конверсия, средний чек, срок сделки)
 *   - Разбивка по неделям (weeks[]) — основа для всех графиков по времени
 *   - КОМ-метрики отдельно (kom_ytd, kom_leads_ytd)
 *   - Воронка регистраций (reg_ytd) — по источнику SOURCE_ID='79641902890'
 *   - Разбивка по источникам, форматам, продуктам, менеджерам
 *   - Стек-данные для графика недельной динамики (stack_*)
 *   - Рейтинги менеджеров
 *   - data.fetched_at — время актуальности данных (из fetched_at.json)
 *
 * ВЫЗЫВАЕТСЯ: только через agg-cache.js (не напрямую).
 * НЕ ВЫЗЫВАЕТСЯ: во время npm run fetch — это только runtime-функция.
 *
 * КОНСТАНТЫ:
 *   YEAR=2026, MIN_OPP=11.0 (минимальная сумма сделки для учёта),
 *   VALID_CATS=[0,8,19] (воронки Pre Sale, обычная, КОМ),
 *   REG_SRC_ID='79641902890' (источник "Регистрация")
 */

import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_SERVICE_CACHE = path.join(__dirname, 'cache');

// Все бизнес-константы и правила — в едином модуле deal-rules.js
import {
  YEAR, MIN_OPP, VALID_CATS, REG_SRC_ID, MBA_DIRECTION_IDS,
  MQL_SALE_STAGES, NOT_MQL_SALE, EDU_TYPE_MAP,
  isKomDeal, isInternalSource, detectFormat, detectB2b,
} from './lib/deal-rules.js';

// ── Даты ─────────────────────────────────────────────────────────────────────

function parseDt(s) {
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(+m[1], +m[2]-1, +m[3]);
  m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (m) return new Date(+m[3], +m[2]-1, +m[1]);
  return null;
}

function dateOnly(d) {
  if (!d) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysBetween(a, b) {
  const da = dateOnly(a), db = dateOnly(b);
  return Math.round((db - da) / 86400000);
}

/** ISO calendar: returns [year, week, dow] (dow Mon=1..Sun=7) using local time */
function isoCalendar(d) {
  const local = dateOnly(d);
  const dow = local.getDay() || 7;
  const thu = new Date(local); thu.setDate(local.getDate() + 4 - dow);
  const yr = thu.getFullYear();
  const week = Math.floor((thu - new Date(yr, 0, 1)) / (7 * 86400000)) + 1;
  return [yr, week, dow];
}

function fromISOCalendar(year, week, dow) {
  const jan4 = new Date(year, 0, 4);
  const jan4dow = jan4.getDay() || 7;
  const d = new Date(jan4);
  d.setDate(jan4.getDate() - jan4dow + 1 + (week - 1) * 7 + dow - 1);
  return d;
}

function isoEq(d, year, week) {
  const [y, w] = isoCalendar(d);
  return y === year && w === week;
}

function fmt2(n) { return String(n).padStart(2, '0'); }

function weekLabel(year, week, today) {
  const mon = fromISOCalendar(year, week, 1);
  const sun = new Date(Math.min(fromISOCalendar(year, week, 7), today));
  return `W${fmt2(week)} (${fmt2(mon.getDate())}.${fmt2(mon.getMonth()+1)}—${fmt2(sun.getDate())}.${fmt2(sun.getMonth()+1)})`;
}

// ── Бизнес-логика ─────────────────────────────────────────────────────────────

const RE_COPY  = /^КОПИЯ для статистики:\s*/;
const RE_KOMPFX = /^КОМ[.,\s]*/;
const RE_GIFT  = /\bПодарок[_:\s]*/g;
const RE_CONTRACT = /\s*Договор\s*№.*$/i;
const RE_CITY  = /\s*в\s+г\.?\s*[А-ЯЁA-Z][а-яёa-z\-]+/gi;
const RE_DRANGE = /\b\d{1,2}-\d{1,2}\.\d{1,2}\.\d{2,4}\b|\b\d{1,2}\.\d{1,2}-\d{1,2}\.\d{1,2}\.\d{2,4}\b/g;  // диапазон дат: 17-20.08.2026 или 30.11-03.12.2026 — до одиночных дат
const RE_DATE2 = /\b\d{1,2}\.\d{1,2}\.\d{2,4}\b/g;
const RE_DATE  = /\d{1,2}[.\-\/]\d{1,2}([.\-\/]\d{2,4})?(-\d{1,2}[.\-\/]\d{1,2}([.\-\/]\d{2,4})?)?/g;
const RE_RANGE = /\d{1,2}-\d{1,2}\.?\d{0,2}/g;
const RE_PDATE = /\s*\(\s*с\s+\d.*?\)/gi;
const RE_SDO   = /\(\s*СДО\s*\)/g;

function normalizeProduct(title) {
  let t = title || '';
  t = t.replace(RE_COPY,'').replace(RE_KOMPFX,'').replace(RE_GIFT,'').replace(RE_CONTRACT,'');
  t = t.replace(RE_CITY,'').replace(RE_DRANGE,'').replace(RE_DATE2,'').replace(RE_DATE,'').replace(RE_RANGE,'');
  t = t.replace(RE_PDATE,'').replace(RE_SDO,'').replace(/_+/g,' ').replace(/\s+/g,' ').trim();
  return t.replace(/^[ .,:;"«»()\-–—]+|[ .,:;"«»()\-–—]+$/g,'') || title;
}

function isPaid(r) { return r.OPP >= MIN_OPP && r.PAY_DT !== null; }
function getPayYear(r) { return (isPaid(r) && r.PAY_DT) ? r.PAY_DT.getFullYear() : null; }
function getPayDate(r) { return (isPaid(r) && r.PAY_DT) ? dateOnly(r.PAY_DT) : null; }
function payYtd(r) { return getPayYear(r) === YEAR; }

// ── Метрики ───────────────────────────────────────────────────────────────────

function metrics(subset, { isKomBlock=false, isOomBlock=false }={}) {
  const pred = isOomBlock ? r => r.IS_OOM && VALID_CATS.has(r.CAT_ID)
             : isKomBlock ? r => r.IS_KOM
             : r => VALID_CATS.has(r.CAT_ID);

  const paid = subset.filter(r => isPaid(r) && pred(r) && r.PAY_DT.getFullYear() === YEAR);
  const posSum = paid.reduce((s,r) => s+r.OPP, 0);
  const posCnt = paid.length;
  const chs = paid.map(r=>r.OPP).sort((a,b)=>a-b);
  const med = chs.length ? chs[Math.floor(chs.length/2)] : 0;

  const durPairs = paid.filter(r=>r.DC&&r.PAY_DT&&daysBetween(r.DC,r.PAY_DT)>=0)
                       .map(r=>[daysBetween(r.DC,r.PAY_DT), r.OPP]);
  const durs = durPairs.map(p=>p[0]);
  const totalOpp = durPairs.reduce((s,p)=>s+p[1],0);
  const avgDur = durs.length ? durs.reduce((s,d)=>s+d,0)/durs.length : 0;
  const avgDurW = totalOpp ? durPairs.reduce((s,[d,o])=>s+d*o,0)/totalOpp : 0;
  const sortedDurs = [...durs].sort((a,b)=>a-b);
  const medDur = sortedDurs.length ? sortedDurs[Math.floor(sortedDurs.length/2)] : 0;

  let loseDurs=[], loseCnt=0;
  for (const r of subset) {
    if (r.SEM==='F' && r.CL && pred(r)) {
      loseCnt++;
      if (r.DC) { const d=daysBetween(r.DC,r.CL); if(d>=0) loseDurs.push(d); }
    }
  }
  const avgLose = loseDurs.length ? loseDurs.reduce((s,d)=>s+d,0)/loseDurs.length : 0;
  const conv = (posCnt+loseCnt) ? posCnt/(posCnt+loseCnt)*100 : 0;

  return {
    postupleniya: posSum, won_relevant_cnt: posCnt, won_total_cnt: posCnt, zero_won_pct: 0,
    avg_check: posCnt ? posSum/posCnt : 0, median_check: med,
    max_check: paid.reduce((m,r)=>Math.max(m,r.OPP), 0),
    min_check: chs.length ? chs[0] : 0,
    avg_close_days_won: avgDur,
    avg_close_days_won_weighted: Math.round(avgDurW*10)/10,
    median_close_days_won: medDur,
    avg_close_days_lose: avgLose, lose_cnt: loseCnt, conv_deal_pct: conv,
    created_cnt: subset.filter(r=>r.DC&&pred(r)).length,
  };
}

// ── Квалификация ──────────────────────────────────────────────────────────────

function isQualLeadW(r) {
  if (!VALID_CATS.has(r.CAT_ID)) return false;
  if (r.SEM==='S' && r.OPP<MIN_OPP) return false;
  if (r.CAT_ID===0) { return NOT_MQL_SALE.has(r.STAGE) ? false : MQL_SALE_STAGES.has(r.STAGE); }
  if (r.CAT_ID===19) { return !(r.SEM==='S'||r.SEM==='F'); }
  return false;
}

function isAllLead(r) {
  if (!VALID_CATS.has(r.CAT_ID)) return false;
  if (r.SEM==='S' && r.OPP<MIN_OPP) return false;
  return true;
}

function isQualLead(r) {
  if (!VALID_CATS.has(r.CAT_ID)) return false;
  if (r.SEM==='S' && r.OPP<MIN_OPP) return false;
  if (r.CAT_ID===0) { return NOT_MQL_SALE.has(r.STAGE) ? false : MQL_SALE_STAGES.has(r.STAGE); }
  if (r.CAT_ID===19) { return !(r.SEM==='S'||r.SEM==='F'); }
  return false;
}

// ── Стеки ─────────────────────────────────────────────────────────────────────

function isSql1(st, r) {
  if (['DETAILS','PROPOSAL','2','6'].includes(st)) return true;
  if (r.CAT_ID===19 && r.SEM!=='S') {
    const ks=(st||'').replace('C19:','');
    if (['EXECUTING','UC_C670BC','UC_I443UQ'].includes(ks)) return true;
  }
  return false;
}

function isMql1(st, r) {
  if (r.CAT_ID===0) return ['UC_4RJOR4','UC_W6SCHG'].includes(st);
  if (r.CAT_ID===8) return false;
  if (r.CAT_ID===19) {
    if (r.SEM==='S'||r.SEM==='F') return false;
    if (st&&st.includes('LOSE')) return false;
    const ks=(st||'').replace('C19:','');
    return !['EXECUTING','UC_C670BC','UC_I443UQ'].includes(ks);
  }
  return false;
}

function isSql2(st, r) {
  if (['DETAILS','PROPOSAL','2','6','WON'].includes(st)) return true;
  if (r.CAT_ID===19 && r.SEM!=='S') {
    const ks=(st||'').replace('C19:','');
    if (['EXECUTING','UC_C670BC','UC_I443UQ'].includes(ks)) return true;
  }
  if (r.UF_CRM_1753272713011 && ['LOSE','UC_F2YC3N','UC_W6SCHG','UC_670ME2','UC_VKPN0N'].includes(st)) return true;
  return false;
}

function isMql2(st, r) {
  if (r.CAT_ID===0) { return NOT_MQL_SALE.has(st) ? false : MQL_SALE_STAGES.has(st); }
  if (r.CAT_ID===19) {
    if (r.SEM==='S'||r.SEM==='F') return false;
    if (st&&st.includes('LOSE')) return false;
    const ks=(st||'').replace('C19:','');
    return !['EXECUTING','UC_C670BC','UC_I443UQ'].includes(ks);
  }
  return false;
}

function getEffectiveStage(r, weekSun) {
  const moved = parseDt(r.MOVED_TIME);
  if (moved && dateOnly(moved) > weekSun && r.PREVIOUS_STAGE_ID) return r.PREVIOUS_STAGE_ID;
  return r.STAGE||'';
}

// SQL по дате создания (единое правило для недель и месяцев)
function isSqlByCreate(r) {
  const st = r.STAGE;
  if (['DETAILS','PROPOSAL','2','6','WON'].includes(st)) return true;
  if (r.CAT_ID===19 && r.SEM!=='S') {
    const ks=(st||'').replace('C19:','');
    if (['EXECUTING','UC_C670BC','UC_I443UQ'].includes(ks)) return true;
    if (r.UF_CRM_5D133690E1 && ['UC_ALOZ6B','UC_W4ML6H','LOSE'].includes(ks)) return true;
  }
  if (r.UF_CRM_1753272713011 && ['LOSE','UC_F2YC3N','UC_W6SCHG','UC_670ME2','UC_VKPN0N'].includes(st)) return true;
  return false;
}

/**
 * Сегмент стека-2 (создан в периоде → на какой стадии зафиксирован к концу периода).
 * Возвращает 'pay'|'inv'|'rej_nq'|'rej'|'sql'|'mql'|'nq' или null (не входит в стек).
 */
function stack2Seg(r, start, end) {
  if (!VALID_CATS.has(r.CAT_ID)) return null;
  if (r.SEM==='S' && r.OPP<MIN_OPP) return null;
  const dc=r.DC;
  if (!dc || dateOnly(dc)<start || dateOnly(dc)>end) return null;
  if (r.CAT_ID===8 && r.STAGE==='C8:WON') return null;
  const pd=r.PAY_DT;
  if (pd && dateOnly(pd)<=end && r.OPP>=MIN_OPP) return 'pay';
  if (r.INV_DT && dateOnly(r.INV_DT)<=end) return 'inv';
  if (r.CAT_ID===8 && r.STAGE==='C8:LOSE') return 'rej_nq';
  if (r.SEM==='F' && r.CL && dateOnly(r.CL)<=end && r.CLOSED==='Y') return 'rej';
  const eff=getEffectiveStage(r,end);
  return isSql2(eff,r) ? 'sql' : isMql2(eff,r) ? 'mql' : 'nq';
}

// ── Регистрация ───────────────────────────────────────────────────────────────

function regIsPaid(r) { return !!r.PAY_DT && r.OPP>=MIN_OPP; }
function regIsLose(r) { return r.SEM==='F'; }
function regIsSql(r)  { return r.SEM==='P' && r.OPP>=MIN_OPP && !r.INV_DT && !r.PAY_DT; }
function regIsInvoice(r) { return r.SEM!=='F' && (!!r.INV_DT || regIsPaid(r)); }

function calcRegFunnel(subset) {
  let sql=0,inv=0,paid=0,lose=0,other=0,paidSum=0;
  let realInvCnt=0, realInvSum=0;
  const totalPaidDurs=[], totalInvDurs=[];

  for (const r of subset) {
    if (regIsLose(r)) lose++;
    else if (regIsInvoice(r)) inv++;
    else if (regIsPaid(r)) { paid++; paidSum+=r.OPP; }
    else if (regIsSql(r)) sql++;
    else other++;
  }

  const totalPaid = subset.filter(regIsPaid).length;
  const totalPaidSum = subset.filter(regIsPaid).reduce((s,r)=>s+r.OPP,0);
  const sqlSum = subset.filter(regIsSql).reduce((s,r)=>s+r.OPP,0);
  const invSum = subset.filter(regIsInvoice).reduce((s,r)=>s+r.OPP,0);
  const loseSum = subset.filter(regIsLose).reduce((s,r)=>s+r.OPP,0);

  for (const r of subset) {
    const invEff = r.INV_DT ? r.INV_DT : (regIsPaid(r) ? getPayDate(r) : null);
    if (invEff && r.DC && r.SEM!=='F') {
      const d=daysBetween(r.DC, invEff); if(d>=0) totalInvDurs.push(d);
    }
    if (r.INV_DT && r.SEM!=='F' && !regIsPaid(r)) { realInvCnt++; realInvSum+=r.OPP; }
    if (regIsPaid(r)) {
      const pd=getPayDate(r);
      if (pd&&r.DC) { const d=daysBetween(r.DC,pd); if(d>=0) totalPaidDurs.push(d); }
    }
  }

  const avgDur = totalPaidDurs.length ? totalPaidDurs.reduce((s,d)=>s+d,0)/totalPaidDurs.length : 0;
  const avgInvDur = totalInvDurs.length ? totalInvDurs.reduce((s,d)=>s+d,0)/totalInvDurs.length : 0;
  const total=subset.length;

  return {
    total, sql, sql_sum: Math.round(sqlSum), invoice: inv, inv_sum: Math.round(invSum),
    paid, paid_sum: Math.round(paidSum), total_paid: totalPaid, total_paid_sum: Math.round(totalPaidSum),
    lose, lose_sum: Math.round(loseSum), other,
    avg_check: totalPaid ? Math.round(totalPaidSum/totalPaid) : 0,
    avg_dur: Math.round(avgDur*10)/10, avg_inv_dur: Math.round(avgInvDur*10)/10,
    conv: total ? Math.round(totalPaid/total*100*10)/10 : 0,
    lose_pct: total ? Math.round(lose/total*100*10)/10 : 0,
    real_inv_cnt: realInvCnt, real_inv_sum: Math.round(realInvSum),
    inv_conv: total ? Math.round(inv/total*100*10)/10 : 0,
  };
}

// ── MBA ───────────────────────────────────────────────────────────────────────

function hasMbaInTitle(title) {
  const t=(title||'').toLowerCase();
  return t.includes('micro')||t.includes('микро')||t.includes('эксперт')||t.includes('expert')
    ||((t.includes('лидер')||t.includes('leader'))&&(t.includes('mba')||t.includes('mmba')))
    ||((t.includes('классический')||t.includes('classic'))&&(t.includes('mini')||t.includes('mmba')||t.includes('mba')))
    ||(t.includes('mini')&&(t.includes('mba')||t.includes('mmba')))
    ||t.includes('специализация')||t.includes('specialization')
    ||t.includes('mba')||t.includes('mmba');
}

function detectMbaType(title) {
  const t=(title||'').toLowerCase();
  if (t.includes('micro')||t.includes('микро')) return 'Micro MBA';
  if (t.includes('эксперт')||t.includes('expert')) return 'MBA Эксперт';
  if ((t.includes('лидер')||t.includes('leader'))&&(t.includes('mba')||t.includes('mmba'))) return 'MBA Лидер';
  if ((t.includes('классический')||t.includes('classic'))&&(t.includes('mini')||t.includes('mmba')||t.includes('mba'))) return 'Mini MBA: Классический';
  if (t.includes('mini')&&(t.includes('mba')||t.includes('mmba'))) return 'Mini MBA: Специализация';
  if (t.includes('специализация')||t.includes('specialization')) return 'Mini MBA: Специализация';
  return null;
}

// ── Главная функция ───────────────────────────────────────────────────────────

export async function analyze(onProgress) {
  const emit = (msg) => {
    if (onProgress) onProgress(msg);
  };

  emit({ type: 'step_start', idx: 0 });

  // Загрузка данных
  const dealsRaw = JSON.parse(await readFile(path.join(DATA_SERVICE_CACHE, 'deals.json'), 'utf-8'));
  const dicts    = JSON.parse(await readFile(path.join(DATA_SERVICE_CACHE, 'dicts.json'), 'utf-8'));

  let fetchedAt = null;
  try {
    const fa = JSON.parse(await readFile(path.join(DATA_SERVICE_CACHE, 'fetched_at.json'), 'utf-8'));
    fetchedAt = fa.fetchedAt || null;
  } catch { /* файл ещё не создан */ }
  if (!fetchedAt) {
    try {
      const { stat } = await import('fs/promises');
      const st = await stat(path.join(DATA_SERVICE_CACHE, 'deals.json'));
      fetchedAt = st.mtime.toISOString();
    } catch { /* ignore */ }
  }

  const cc = {};
  const leads = [];

  let companies = {};
  try {
    companies = JSON.parse(await readFile(path.join(DATA_SERVICE_CACHE, 'companies.json'), 'utf-8'));
  } catch { /* companies.json не найден — топ компаний будет без названий */ }

  const cats       = dicts.categories || {};
  const usersMap   = dicts.users || {};
  const sourcesMap = dicts.sources || {};
  const directions = dicts.directions || {};

  const TODAY = dateOnly(new Date());
  const [, curW] = isoCalendar(TODAY);
  const prevW = curW > 1 ? curW-1 : 1;

  // Обогащение сделок
  const rows = dealsRaw.map(x => {
    const catId = parseInt(x.CATEGORY_ID||0);
    const cat   = cats[String(catId)] || String(catId);
    const isKom = isKomDeal(x);
    let fmt = detectFormat(x.TITLE||'', x.UF_FORMAT);
    if (String(x.ID)==='321458'||String(x.ID)==='321895') fmt='Видеокурс';
    const dir = x.UF_CRM_1498466811||[];
    const dirArr = Array.isArray(dir)?dir:(dir?[dir]:[]);
    return {
      DIR: dirArr.length ? (directions[String(dirArr[0])] || '—') : '—',
      ID: x.ID, TITLE: x.TITLE||'',
      OPP: parseFloat(x.OPPORTUNITY||0),
      SEM: x.STAGE_SEMANTIC_ID||null, STAGE: x.STAGE_ID||'',
      DC:  parseDt(x.DATE_CREATE), CL: parseDt(x.CLOSEDATE),
      PAY_DT: parseDt(x.UF_DATE_PAY_1C), CLOSED: x.CLOSED,
      MGR: usersMap[String(x.ASSIGNED_BY_ID||'')] || x.ASSIGNED_BY_ID||'',
      MGR_ID: String(x.ASSIGNED_BY_ID||''),
      CAT: cat, CAT_ID: catId,
      SRC: sourcesMap[x.SOURCE_ID||''] || x.SOURCE_ID||'—',
      SRC_ID: x.SOURCE_ID||'',
      FORMAT: fmt, UF_FORMAT: String(x.UF_FORMAT||''),
      COMPANY_ID: String(x.COMPANY_ID||'0'),
      BTYPE: detectB2b(x),
      PRODUCT: normalizeProduct(x.TITLE||''),
      IS_KOM: isKom, IS_OOM: !isKom,
      IS_PRESALE: cat==='Pre Sale',
      EDU_TYPE: String(x.UF_CRM_1765896709800||''),
      INV_DT: parseDt(x.UF_CRM_1753272713011),
      IS_INTERNAL_SRC: isInternalSource(x.SOURCE_ID||''),
      UF_CRM_1753272713011: x.UF_CRM_1753272713011||'',
      UF_CRM_5D133690E1: x.UF_CRM_5D133690E1||null,
      MOVED_TIME: x.MOVED_TIME||null,
      PREVIOUS_STAGE_ID: x.PREVIOUS_STAGE_ID||null,
      UF_CRM_1498466811: Array.isArray(dir)?dir:(dir?[dir]:[]),
    };
  });

  emit({ type: 'deals_loaded', count: rows.length });

  // YTD
  const ytdSubset = rows.filter(r =>
    (r.DC&&r.DC.getFullYear()===YEAR)||(r.CL&&r.CL.getFullYear()===YEAR)||payYtd(r));
  const mYtd    = metrics(ytdSubset);
  const mKomYtd = metrics(ytdSubset,{isKomBlock:true});
  const mOomYtd = metrics(ytdSubset,{isOomBlock:true});

  const wsPrevPay = rows.filter(r=>{ const pd=getPayDate(r); return pd&&isoEq(pd,YEAR,prevW); });
  const wsCurPay  = rows.filter(r=>{ const pd=getPayDate(r); return pd&&isoEq(pd,YEAR,curW);  });
  const mPrev    = metrics(wsPrevPay);
  const mCur     = metrics(wsCurPay);
  const mKomPrev = metrics(wsPrevPay,{isKomBlock:true});
  const mKomCur  = metrics(wsCurPay, {isKomBlock:true});
  const mOomPrev = metrics(wsPrevPay,{isOomBlock:true});
  const mOomCur  = metrics(wsCurPay, {isOomBlock:true});

  // ── Недельная воронка ─────────────────────────────────────────────────────
  const weekly = {};
  for (let w=1; w<=curW; w++) {
    let mon; try { mon=fromISOCalendar(YEAR,w,1); } catch { continue; }
    const sun7=fromISOCalendar(YEAR,w,7);
    const sun=new Date(Math.min(sun7,TODAY));
    weekly[w] = {
      week:w, mon:mon.toISOString().slice(0,10), sun:sun.toISOString().slice(0,10),
      label:weekLabel(YEAR,w,TODAY), label_short:`W${fmt2(w)}`,
      label_dates:`${fmt2(mon.getDate())}.${fmt2(mon.getMonth()+1)}—${fmt2(sun.getDate())}.${fmt2(sun.getMonth()+1)}`,
      created_cnt:0, created_sum:0,
      postupleniya:0, won_cnt:0, lost_cnt:0, leads:0, avg_check:0,
      durs:[], chks:[], oom_durs:[], oom_chks:[], kom_durs:[], kom_chks:[],
      mql:0, sql:0, oplata:0,
      kom_postupleniya:0, kom_won_cnt:0, kom_lost_cnt:0, invoice_cnt:0,
      oom_postupleniya:0, oom_won_cnt:0, oom_leads:0, oom_mql:0,
      fmt_oom:0, fmt_om:0, fmt_sdo:0, fmt_kom:0,
      fmt_oom_cnt:0, fmt_om_cnt:0, fmt_sdo_cnt:0, fmt_kom_cnt:0, presale_durs:[],
      by_prod:{}, by_src:{}, by_mba:{},
      btype_B2B_cnt:0,btype_B2B_sum:0,btype_B2C_cnt:0,btype_B2C_sum:0,
      src_internal_cnt:0,src_internal_sum:0,src_mkt_cnt:0,src_mkt_sum:0,
      edu_pk_cnt:0,edu_pk_sum:0,edu_pp_cnt:0,edu_pp_sum:0,edu_ko_cnt:0,edu_ko_sum:0,
      reg_total:0,reg_sql:0,reg_sql_sum:0,reg_invoice:0,reg_invoice_sum:0,
      reg_paid:0,reg_paid_sum:0,reg_lose:0,reg_lose_sum:0,
      reg_durs:[], reg_inv_durs:[],
    };
  }

  for (const r of rows) {
    // created_cnt (ООМ, от 2024)
    if (r.IS_OOM && r.DC && r.DC.getFullYear()>=2024) {
      const [,wk]=isoCalendar(r.DC);
      if (wk in weekly && r.OPP>=MIN_OPP) { weekly[wk].created_cnt++; weekly[wk].created_sum+=r.OPP; }
    }

    // lost_cnt
    if (r.IS_OOM && r.CL && r.CL.getFullYear()===YEAR && r.CLOSED==='Y') {
      const [,wk]=isoCalendar(r.CL);
      if (wk in weekly && r.SEM==='F') weekly[wk].lost_cnt++;
    }
    if (r.IS_KOM && r.STAGE && r.STAGE.includes('LOSE') && r.CL && r.CL.getFullYear()===YEAR) {
      const [,wk]=isoCalendar(r.CL);
      if (wk in weekly) weekly[wk].kom_lost_cnt++;
    }

    // invoice_cnt — по ДАТЕ СЧЁТА
    if (r.UF_CRM_1753272713011) {
      const inv=parseDt(r.UF_CRM_1753272713011);
      if (inv && inv.getFullYear()===YEAR) {
        const [,wk]=isoCalendar(inv);
        if (wk in weekly) { const wd=weekly[wk]; wd.invoice_cnt++;
          if(!r.IS_KOM){ const sn=r.SRC; if(!wd.by_src[sn]) wd.by_src[sn]={deals:0,sum:0,durs:[],mql:0,sql:0,invoice_cnt:0,leads:0}; wd.by_src[sn].invoice_cnt++; } }
      }
    }

    // postupleniya по дате оплаты
    if (payYtd(r) && VALID_CATS.has(r.CAT_ID)) {
      const pd=getPayDate(r);
      if (pd) {
        const [,wk]=isoCalendar(pd);
        if (wk in weekly) {
          const wd=weekly[wk];
          wd.postupleniya+=r.OPP; wd.oplata++;
          if (r.IS_KOM) { wd.kom_postupleniya+=r.OPP; wd.kom_won_cnt++; wd.kom_chks.push(r.OPP); }
          else           { wd.oom_postupleniya+=r.OPP; wd.oom_won_cnt++; wd.won_cnt++; wd.chks.push(r.OPP); wd.oom_chks.push(r.OPP); }
          const fk={'Очный':'fmt_oom','Онлайн':'fmt_om','Видеокурс':'fmt_sdo','Корпоративное обучение':'fmt_kom'};
          if (fk[r.FORMAT]) { wd[fk[r.FORMAT]]+=r.OPP; wd[fk[r.FORMAT]+'_cnt']++; }
          wd[`btype_${r.BTYPE}_cnt`]++; wd[`btype_${r.BTYPE}_sum`]+=r.OPP;
          if (isInternalSource(r.SRC_ID)) { wd.src_internal_cnt++; wd.src_internal_sum+=r.OPP; }
          else { wd.src_mkt_cnt++; wd.src_mkt_sum+=r.OPP; }
          const ek={'34699':'pk','34700':'pp','34765':'ko'}[r.EDU_TYPE];
          if (ek) { wd[`edu_${ek}_cnt`]++; wd[`edu_${ek}_sum`]+=r.OPP; }
          if (String(r.SRC_ID)===REG_SRC_ID) {
            wd.reg_total++; wd.reg_paid++; wd.reg_paid_sum+=r.OPP;
            if (r.DC&&r.PAY_DT) { const d=daysBetween(r.DC,r.PAY_DT); if(d>=0) wd.reg_durs.push(d); }
          }
          if (r.DC&&r.PAY_DT) {
            const d=daysBetween(r.DC,r.PAY_DT);
            if (d>=0) { wd.durs.push(d); if(r.IS_KOM) wd.kom_durs.push(d); else wd.oom_durs.push(d); }
          }
          // by_prod: только ООМ, без конструктора (ILP) — таблица продуктов пересчитывается из by_prod
          if (!r.IS_KOM && r.FORMAT!=='КОМ' && !/\bILP\b/i.test(r.TITLE||'')) {
            const pk=r.PRODUCT.slice(0,90);
            if (!wd.by_prod[pk]) wd.by_prod[pk]={deals:0,sum:0,fmt_ochn_cnt:0,fmt_ochn_sum:0,fmt_om_cnt:0,fmt_om_sum:0,fmt_sdo_cnt:0,fmt_sdo_sum:0,durs:[],dir:r.DIR};
            if (!wd.by_prod[pk].dir || wd.by_prod[pk].dir==='—') wd.by_prod[pk].dir=r.DIR;  // направление курса (для фильтра в рейтингах)
            wd.by_prod[pk].deals++; wd.by_prod[pk].sum+=r.OPP;
            if (r.FORMAT==='Очный') { wd.by_prod[pk].fmt_ochn_cnt++; wd.by_prod[pk].fmt_ochn_sum+=r.OPP; }
            else if (r.FORMAT==='Онлайн') { wd.by_prod[pk].fmt_om_cnt++; wd.by_prod[pk].fmt_om_sum+=r.OPP; }
            else { wd.by_prod[pk].fmt_sdo_cnt++; wd.by_prod[pk].fmt_sdo_sum+=r.OPP; }
            if (r.DC&&r.PAY_DT) { const d=daysBetween(r.DC,r.PAY_DT); if(d>=0) wd.by_prod[pk].durs.push(d); }
          }
          // by_src
          // by_src: сделки/поступления — по дате оплаты (реальные деньги).
          // MQL/SQL — по дате создания, счёт — по дате счёта (см. секции ниже),
          // чтобы воронка источников была как в управленческом (без >100%).
          if(!r.IS_KOM){ const sn=r.SRC; if(!wd.by_src[sn]) wd.by_src[sn]={deals:0,sum:0,durs:[],mql:0,sql:0,invoice_cnt:0,leads:0}; wd.by_src[sn].deals++; wd.by_src[sn].sum+=r.OPP; if(r.DC&&r.PAY_DT){const d=daysBetween(r.DC,r.PAY_DT);if(d>=0)wd.by_src[sn].durs.push(d);} }
          // by_company
          { const cid=r.COMPANY_ID; if(cid&&cid!=='0'){if(!wd.by_company) wd.by_company={}; if(!wd.by_company[cid]) wd.by_company[cid]={sum:0,cnt:0,last:null,om_cnt:0,om_sum:0,kom_cnt:0,kom_sum:0}; wd.by_company[cid].sum+=r.OPP; wd.by_company[cid].cnt++; if(!r.IS_KOM){wd.by_company[cid].om_cnt++;wd.by_company[cid].om_sum+=r.OPP;} else {wd.by_company[cid].kom_cnt++;wd.by_company[cid].kom_sum+=r.OPP;} const pd2=getPayDate(r); if(pd2&&(!wd.by_company[cid].last||pd2>wd.by_company[cid].last))wd.by_company[cid].last=pd2.toISOString().slice(0,10); } }
          // by_mba
          { const isMba=r.UF_CRM_1498466811.map(String).some(d=>MBA_DIRECTION_IDS.has(d))||hasMbaInTitle(r.TITLE); if(isMba){const mt=detectMbaType(r.TITLE);if(mt){if(!wd.by_mba[mt])wd.by_mba[mt]={cnt:0,sum:0,fmt_ochn_cnt:0,fmt_ochn_sum:0,fmt_om_cnt:0,fmt_om_sum:0,fmt_sdo_cnt:0,fmt_sdo_sum:0};wd.by_mba[mt].cnt++;wd.by_mba[mt].sum+=r.OPP;if(r.FORMAT==='Очный'){wd.by_mba[mt].fmt_ochn_cnt++;wd.by_mba[mt].fmt_ochn_sum+=r.OPP;}else if(r.FORMAT==='Онлайн'){wd.by_mba[mt].fmt_om_cnt++;wd.by_mba[mt].fmt_om_sum+=r.OPP;}else{wd.by_mba[mt].fmt_sdo_cnt++;wd.by_mba[mt].fmt_sdo_sum+=r.OPP;}}}}
        }
      }
    }

    // MQL по DATE_CREATE
    if (r.DC && r.DC.getFullYear()===YEAR && isQualLeadW(r)) {
      const [,wk]=isoCalendar(r.DC);
      if (wk in weekly) { const wd=weekly[wk]; wd.mql++; if(r.IS_OOM) wd.oom_mql++;
        if(!r.IS_KOM){ const sn=r.SRC; if(!wd.by_src[sn]) wd.by_src[sn]={deals:0,sum:0,durs:[],mql:0,sql:0,invoice_cnt:0,leads:0}; wd.by_src[sn].mql++; } }
    }

    // SQL по DATE_CREATE
    if (isSqlByCreate(r) && r.DC && r.DC.getFullYear()===YEAR) {
      const [,wk]=isoCalendar(r.DC);
      if (wk in weekly) { const wd=weekly[wk]; wd.sql++;
        if(!r.IS_KOM){ const sn=r.SRC; if(!wd.by_src[sn]) wd.by_src[sn]={deals:0,sum:0,durs:[],mql:0,sql:0,invoice_cnt:0,leads:0}; wd.by_src[sn].sql++; } }
    }

    // Pre Sale duration
    if (r.IS_PRESALE && r.SEM==='S' && r.CL && r.CL.getFullYear()===YEAR && r.DC) {
      const d=daysBetween(r.DC,r.CL);
      if (d>=0) { const [,wk]=isoCalendar(r.CL); if(wk in weekly) weekly[wk].presale_durs.push(d); }
    }
  }

  // leads
  for (const r of rows) {
    if (r.DC && r.DC.getFullYear()===YEAR && isAllLead(r)) {
      const [,wk]=isoCalendar(r.DC);
      if (wk in weekly) { weekly[wk].leads++; if(r.IS_OOM) weekly[wk].oom_leads++;
        if(!r.IS_KOM){ const sn=r.SRC; if(!weekly[wk].by_src[sn]) weekly[wk].by_src[sn]={deals:0,sum:0,durs:[],mql:0,sql:0,invoice_cnt:0,leads:0}; weekly[wk].by_src[sn].leads++; } }
    }
  }

  // Финализация недель
  const avg = (arr) => arr.length ? arr.reduce((s,x)=>s+x,0)/arr.length : 0;
  const med = (arr) => { const s=[...arr].sort((a,b)=>a-b); return s.length?s[Math.floor(s.length/2)]:0; };
  for (const wd of Object.values(weekly)) {
    wd.avg_check        = wd.won_cnt      ? wd.postupleniya/wd.won_cnt : 0;
    wd.median_check     = med(wd.chks);
    wd.avg_dur          = avg(wd.durs);
    wd.oom_avg_check    = wd.oom_won_cnt  ? wd.oom_postupleniya/wd.oom_won_cnt : 0;
    wd.kom_avg_check    = wd.kom_won_cnt  ? wd.kom_postupleniya/wd.kom_won_cnt : 0;
    wd.oom_median_check = med(wd.oom_chks);
    wd.oom_avg_dur      = avg(wd.oom_durs);
    wd.kom_median_check = med(wd.kom_chks);
    wd.kom_avg_dur      = avg(wd.kom_durs);
    wd.avg_presale_dur  = avg(wd.presale_durs);
    wd.conv_lead_mql      = wd.leads       ? wd.mql/wd.leads*100 : 0;
    wd.conv_mql_sql       = wd.mql         ? wd.sql/wd.mql*100 : 0;
    wd.conv_sql_invoice   = wd.sql         ? wd.invoice_cnt/wd.sql*100 : 0;
    wd.conv_sql_oplata    = wd.sql         ? wd.oplata/wd.sql*100 : 0;
    wd.conv_invoice_oplata= wd.invoice_cnt ? wd.oplata/wd.invoice_cnt*100 : 0;
    for (const k of ['durs','chks','oom_durs','oom_chks','kom_durs','kom_chks','presale_durs']) delete wd[k];
  }

  // ── Предыдущий год (YEAR-1) — упрощённые недельные данные для сравнения ──
  const PREV_YEAR = YEAR - 1;
  const prevWeekly = {};
  for (let w = 1; w <= 53; w++) {
    let mon; try { mon = fromISOCalendar(PREV_YEAR, w, 1); } catch { continue; }
    const sun = fromISOCalendar(PREV_YEAR, w, 7);
    prevWeekly[w] = {
      week: w,
      label_dates: `${fmt2(mon.getDate())}.${fmt2(mon.getMonth()+1)}—${fmt2(sun.getDate())}.${fmt2(sun.getMonth()+1)}`,
      postupleniya: 0, oplata: 0, durs: [],
      oom_postupleniya: 0, oom_won_cnt: 0, oom_durs: [],
      kom_postupleniya: 0, kom_won_cnt: 0, kom_durs: [],
      leads: 0, mql: 0, oom_leads: 0, oom_mql: 0,
    };
  }
  for (const r of rows) {
    if (!getPayDate(r) || r.PAY_DT.getFullYear() !== PREV_YEAR) continue;
    if (!VALID_CATS.has(r.CAT_ID)) continue;
    const [,wk] = isoCalendar(r.PAY_DT);
    if (!(wk in prevWeekly)) continue;
    const wd = prevWeekly[wk];
    wd.postupleniya += r.OPP; wd.oplata++;
    if (r.DC && r.CL) { const d = daysBetween(r.DC, r.CL); if (d >= 0) wd.durs.push(d); }
    if (r.IS_KOM) {
      wd.kom_postupleniya += r.OPP; wd.kom_won_cnt++;
      if (r.DC && r.CL) { const d = daysBetween(r.DC, r.CL); if (d >= 0) wd.kom_durs.push(d); }
    } else {
      wd.oom_postupleniya += r.OPP; wd.oom_won_cnt++;
      if (r.DC && r.CL) { const d = daysBetween(r.DC, r.CL); if (d >= 0) wd.oom_durs.push(d); }
    }
  }
  for (const r of rows) {
    if (!r.DC || r.DC.getFullYear() !== PREV_YEAR) continue;
    const [,wk] = isoCalendar(r.DC);
    if (!(wk in prevWeekly)) continue;
    if (isAllLead(r))     { prevWeekly[wk].leads++;    if (r.IS_OOM) prevWeekly[wk].oom_leads++; }
    if (isQualLeadW(r))   { prevWeekly[wk].mql++;      if (r.IS_OOM) prevWeekly[wk].oom_mql++; }
  }
  { const av = arr => arr.length ? arr.reduce((s,x)=>s+x,0)/arr.length : 0;
    for (const wd of Object.values(prevWeekly)) {
      wd.avg_dur     = av(wd.durs);
      wd.oom_avg_dur = av(wd.oom_durs);
      wd.kom_avg_dur = av(wd.kom_durs);
      delete wd.durs; delete wd.oom_durs; delete wd.kom_durs;
    }
  }

  // ── Стек 1 ────────────────────────────────────────────────────────────────
  for (const wIdx of Object.keys(weekly).map(Number).sort((a,b)=>a-b)) {
    const mon=fromISOCalendar(YEAR,wIdx,1);
    const sun=new Date(Math.min(fromISOCalendar(YEAR,wIdx,7), TODAY));

    for (const r of rows) {
      if (!VALID_CATS.has(r.CAT_ID)) continue;
      let seg=null;
      const pd=r.PAY_DT;
      if (pd && dateOnly(pd)>=mon && dateOnly(pd)<=sun && r.OPP>=MIN_OPP) seg='stack_pay';
      if (!seg) {
        const inv=r.INV_DT;
        if (inv && dateOnly(inv)>=mon && dateOnly(inv)<=sun) seg='stack_inv';
      }
      if (!seg) {
        if (r.SEM==='F' && r.CL && dateOnly(r.CL)>=mon && dateOnly(r.CL)<=sun && r.CLOSED==='Y') seg='stack_rej';
        else if (r.CAT_ID===19 && r.STAGE && r.STAGE.includes('LOSE') && r.CL && dateOnly(r.CL)>=mon && dateOnly(r.CL)<=sun) seg='stack_rej';
      }
      if (!seg) {
        const techWon   = r.SEM==='S' && r.OPP<MIN_OPP;
        const payBefore = pd && dateOnly(pd)<mon;
        const rejBefore = r.SEM==='F' && r.CL && dateOnly(r.CL)<mon && r.CLOSED==='Y';
        const closedBef = r.CLOSED==='Y' && r.CL && dateOnly(r.CL)<mon;
        const komLose   = r.CAT_ID===19 && r.STAGE && r.STAGE.includes('LOSE');
        const wonClosed = r.CLOSED==='Y' && (r.STAGE==='WON'||r.STAGE==='C8:WON');
        if (!techWon && !payBefore && !rejBefore && !closedBef && !komLose && !wonClosed) {
          if (r.CAT_ID===8 && r.STAGE==='C8:LOSE') seg='stack_rej_nq';
          else if (r.DC && dateOnly(r.DC)<=sun) {
            const eff=getEffectiveStage(r,sun);
            seg = isSql1(eff,r) ? 'stack_sql' : isMql1(eff,r) ? 'stack_mql' : 'stack_nq';
          }
        }
      }
      if (seg) {
        weekly[wIdx][seg]=(weekly[wIdx][seg]||0)+1;
        if (['stack_pay','stack_inv','stack_sql'].includes(seg)) weekly[wIdx][seg+'_sum']=(weekly[wIdx][seg+'_sum']||0)+r.OPP;
      }
    }
  }

  // ── Стек 2 ────────────────────────────────────────────────────────────────
  for (const wIdx of Object.keys(weekly).map(Number).sort((a,b)=>a-b)) {
    const mon=fromISOCalendar(YEAR,wIdx,1);
    const sun=new Date(Math.min(fromISOCalendar(YEAR,wIdx,7), TODAY));

    for (const r of rows) {
      const s=stack2Seg(r,mon,sun);
      if (!s) continue;
      const seg='stack2_'+s;
      weekly[wIdx][seg]=(weekly[wIdx][seg]||0)+1;
      if (['stack2_pay','stack2_inv','stack2_sql'].includes(seg)) weekly[wIdx][seg+'_sum']=(weekly[wIdx][seg+'_sum']||0)+r.OPP;
    }
  }

  // Инициализируем stack-поля которые могут отсутствовать
  const stackKeys=['stack_pay','stack_pay_sum','stack_inv','stack_inv_sum','stack_sql','stack_sql_sum',
    'stack_mql','stack_nq','stack_rej','stack_rej_nq',
    'stack2_pay','stack2_pay_sum','stack2_inv','stack2_inv_sum','stack2_sql','stack2_sql_sum',
    'stack2_mql','stack2_nq','stack2_rej','stack2_rej_nq'];
  for (const wd of Object.values(weekly)) for (const k of stackKeys) if (!(k in wd)) wd[k]=0;

  // ── Месячная воронка (переключатель Недели/Месяцы на управленческом) ──────
  // Те же поля, что у недель (точно по календарным месяцам), чтобы фронтенд
  // рендерил месяцы тем же кодом.
  const MONTH_NAMES=['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const monthly={};
  const curM = (TODAY.getFullYear()===YEAR) ? TODAY.getMonth() : 11;
  for (let m=0;m<=curM;m++) {
    const start=new Date(YEAR,m,1);
    const end=new Date(Math.min(new Date(YEAR,m+1,0), TODAY));
    monthly[m]={
      month:m+1, week:m+1, // week — для совместимости с рендером недель
      start:start.toISOString().slice(0,10), end:end.toISOString().slice(0,10),
      label_dates:MONTH_NAMES[m], label_short:MONTH_NAMES[m],
      postupleniya:0, won_cnt:0, leads:0, oom_leads:0, mql:0, oom_mql:0, sql:0,
      oplata:0, invoice_cnt:0,
      oom_postupleniya:0, oom_won_cnt:0, kom_postupleniya:0, kom_won_cnt:0,
      durs:[], chks:[],
    };
  }
  const monthOf = d => { const x=dateOnly(d); return (x.getFullYear()===YEAR && x>=new Date(YEAR,0,1)) ? x.getMonth() : -1; };
  for (const r of rows) {
    // деньги по дате оплаты
    if (payYtd(r) && VALID_CATS.has(r.CAT_ID)) {
      const pd=getPayDate(r);
      const m=pd?monthOf(pd):-1;
      if (m in monthly) {
        const md=monthly[m];
        md.postupleniya+=r.OPP; md.oplata++;
        if (r.IS_KOM) { md.kom_postupleniya+=r.OPP; md.kom_won_cnt++; }
        else { md.oom_postupleniya+=r.OPP; md.oom_won_cnt++; md.won_cnt++; md.chks.push(r.OPP); }
        if (r.DC&&r.PAY_DT) { const d=daysBetween(r.DC,r.PAY_DT); if(d>=0) md.durs.push(d); }
      }
    }
    // счёт по дате счёта
    if (r.UF_CRM_1753272713011) {
      const inv=parseDt(r.UF_CRM_1753272713011);
      const m=inv?monthOf(inv):-1;
      if (m in monthly) monthly[m].invoice_cnt++;
    }
    // лиды/MQL/SQL по дате создания
    if (r.DC) {
      const m=monthOf(r.DC);
      if (m in monthly) {
        const md=monthly[m];
        if (isAllLead(r))   { md.leads++; if(r.IS_OOM) md.oom_leads++; }
        if (isQualLeadW(r)) { md.mql++;   if(r.IS_OOM) md.oom_mql++; }
        if (isSqlByCreate(r)) md.sql++;
      }
    }
  }
  // стек-2 по месяцам
  for (const m of Object.keys(monthly).map(Number)) {
    const md=monthly[m];
    const start=new Date(YEAR,m,1);
    const end=new Date(Math.min(new Date(YEAR,m+1,0), TODAY));
    for (const r of rows) {
      const s=stack2Seg(r,start,end);
      if (!s) continue;
      const seg='stack2_'+s;
      md[seg]=(md[seg]||0)+1;
      if (['stack2_pay','stack2_inv','stack2_sql'].includes(seg)) md[seg+'_sum']=(md[seg+'_sum']||0)+r.OPP;
    }
    for (const k of stackKeys) if (!(k in md)) md[k]=0;
  }
  // финализация месяцев (те же формулы, что у недель)
  for (const md of Object.values(monthly)) {
    md.avg_check = md.won_cnt ? md.postupleniya/md.won_cnt : 0;
    md.oom_avg_check = md.oom_won_cnt ? md.oom_postupleniya/md.oom_won_cnt : 0;
    md.kom_avg_check = md.kom_won_cnt ? md.kom_postupleniya/md.kom_won_cnt : 0;
    md.avg_dur = md.durs.length ? md.durs.reduce((s,x)=>s+x,0)/md.durs.length : 0;
    md.conv_lead_mql       = md.leads       ? md.mql/md.leads*100 : 0;
    md.conv_mql_sql        = md.mql         ? md.sql/md.mql*100 : 0;
    md.conv_sql_invoice    = md.sql         ? md.invoice_cnt/md.sql*100 : 0;
    md.conv_sql_oplata     = md.sql         ? md.oplata/md.sql*100 : 0;
    md.conv_invoice_oplata = md.invoice_cnt ? md.oplata/md.invoice_cnt*100 : 0;
    delete md.durs; delete md.chks;
  }

  // ── Источники ─────────────────────────────────────────────────────────────
  const srcData={};
  const getSrc=n=>{ if(!srcData[n]) srcData[n]={postupleniya:0,deals:0,mql:0,sql:0,postupleniya_week:0,leads:0,durs:[]}; return srcData[n]; };
  for (const r of rows) if(r.IS_PRESALE&&r.DC&&r.DC.getFullYear()===YEAR) getSrc(r.SRC).mql++;
  for (const r of rows) if(r.IS_PRESALE&&r.SEM==='S'&&r.CL&&r.CL.getFullYear()===YEAR) getSrc(r.SRC).sql++;
  for (const r of rows) if(payYtd(r)&&!r.IS_KOM) {
    const sd=getSrc(r.SRC); sd.postupleniya+=r.OPP; sd.deals++;
    if(r.DC&&r.CL){const d=daysBetween(r.DC,r.CL);if(d>=0)sd.durs.push(d);}
    const pdS=getPayDate(r); if(pdS&&isoEq(pdS,YEAR,curW)) sd.postupleniya_week+=r.OPP;
  }
  for (const l of leads) {
    const d=parseDt(l.DATE_CREATE);
    if(d&&d.getFullYear()===YEAR) getSrc(sourcesMap[l.SOURCE_ID||'']||'—').leads++;
  }

  const srcItem=(name,d)=>({
    name, postupleniya:d.postupleniya, deals:d.deals, mql:d.mql, sql:d.sql,
    postupleniya_week:d.postupleniya_week, leads:d.leads,
    avg_check:Math.round(d.deals?d.postupleniya/d.deals:0),
    avg_won_days:Math.round(avg(d.durs)*10)/10,
    conv_mql_sql:d.mql?Math.round(d.sql/d.mql*100*10)/10:0,
    conv_sql_deals:d.sql?Math.round(d.deals/d.sql*100*10)/10:0,
    conv_lead_deals:d.leads?Math.round(d.deals/d.leads*100*10)/10:0,
  });

  const srcList=Object.entries(srcData).map(([k,v])=>srcItem(k,v)).sort((a,b)=>b.postupleniya-a.postupleniya);
  const allDurs=rows.filter(payYtd).filter(r=>r.DC&&r.CL).map(r=>{const d=daysBetween(r.DC,r.CL);return d>=0?d:null;}).filter(d=>d!==null);
  const totalRow=srcItem('📊 ИТОГО',{
    postupleniya:srcList.reduce((s,x)=>s+x.postupleniya,0),
    deals:srcList.reduce((s,x)=>s+x.deals,0), mql:srcList.reduce((s,x)=>s+x.mql,0),
    sql:srcList.reduce((s,x)=>s+x.sql,0), postupleniya_week:srcList.reduce((s,x)=>s+x.postupleniya_week,0),
    leads:srcList.reduce((s,x)=>s+x.leads,0), durs:allDurs,
  });
  const srcRating=[totalRow,...srcList.slice(0,20)];

  // ── Источники: полная воронка (без КОМ, как управленческий дашборд) ──────
  // Зеркалит логику управленческого дашборда:
  //   - Лиды: по ДАТЕ СОЗДАНИЯ (DC) в этом году
  //   - MQL/SQL/Счёт/Сделки/Поступления: по ДАТЕ ОПЛАТЫ (payYtd) в этом году
  const srcFunnel={};
  const getF=n=>{if(!srcFunnel[n])srcFunnel[n]={leads:0,mql:0,sql:0,invoice_cnt:0,deals:0,postupleniya:0,durs:[],type:''};return srcFunnel[n];};
  const srcType={};  // srcName → 'internal'|'marketing' (по первому встреченному SRC_ID)
  for(const r of rows){
    if(r.IS_KOM) continue;
    if(!VALID_CATS.has(r.CAT_ID)) continue;
    const sn=r.SRC;
    if(!srcType[sn]) srcType[sn]=isInternalSource(r.SRC_ID)?'internal':'marketing';
    const sd=getF(sn); sd.type=srcType[sn];
    // MQL/SQL/Счёт/Сделки/Поступления — только оплаченные в этом году (как в управленческом)
    if(payYtd(r)){
      if(isQualLeadW(r)) sd.mql++;
      if(isSqlByCreate(r)) sd.sql++;
      if(r.INV_DT) sd.invoice_cnt++;
      sd.deals++;sd.postupleniya+=r.OPP;
      if(r.DC&&r.PAY_DT){const d=daysBetween(r.DC,r.PAY_DT);if(d>=0)sd.durs.push(d);}
    }
  }
  // Лиды — отдельным проходом по дате создания (как в управленческом)
  for(const r of rows){
    if(r.IS_KOM) continue;
    if(!VALID_CATS.has(r.CAT_ID)) continue;
    if(!r.DC||r.DC.getFullYear()!==YEAR) continue;
    const sn=r.SRC;
    if(!srcType[sn]) srcType[sn]=isInternalSource(r.SRC_ID)?'internal':'marketing';
    if(isAllLead(r)) getF(sn).leads++;
  }
  function sfItem(name,d){return{name,...d,avg_check:d.deals?Math.round(d.postupleniya/d.deals):0,avg_dur:avg(d.durs)}};
  const srcFunnelList=Object.entries(srcFunnel).map(([n,d])=>sfItem(n,d)).sort((a,b)=>b.postupleniya-a.postupleniya);
  const sfTop=srcFunnelList.slice(0,20);
  const sfRest=srcFunnelList.slice(20);
  const sfAgg=(list,withDurs)=>{const r={leads:0,mql:0,sql:0,invoice_cnt:0,deals:0,postupleniya:0};for(const x of list){r.leads+=x.leads;r.mql+=x.mql;r.sql+=x.sql;r.invoice_cnt+=x.invoice_cnt;r.deals+=x.deals;r.postupleniya+=x.postupleniya;}r.avg_check=r.deals?Math.round(r.postupleniya/r.deals):0;if(withDurs&&list.length){const c=list.reduce((s,x)=>s+(x.avg_dur||0)*(x.deals||0),0);r.avg_dur=list.reduce((s,x)=>s+(x.deals||0),0)?c/list.reduce((s,x)=>s+(x.deals||0),0):0;}else r.avg_dur=0;return r;};
  const sfTopTotal={name:'📊 ИТОГО (топ-20)',...sfAgg(sfTop,true),type:''};
  const sfAllTotal={name:'📊 ИТОГО (все без КОМ)',...sfAgg(srcFunnelList,true),type:''};
  let sfRestRow=null;
  if(sfRest.length){
    const rAgg=sfAgg(sfRest,false);
    rAgg.avg_dur=0;
    sfRestRow={name:`📦 Остальные (${sfRest.length} источников)`,...rAgg,type:''};
  }
  const srcFunnelRating=[sfTopTotal,...sfTop,sfRestRow,sfAllTotal].filter(Boolean);

  // ── B2B/B2C ───────────────────────────────────────────────────────────────
  const bsplit=(subset,period)=>{ const g={}; for(const r of subset) if(isPaid(r)){if(!g[r.BTYPE])g[r.BTYPE]={cnt:0,sum:0};g[r.BTYPE].cnt++;g[r.BTYPE].sum+=r.OPP;} return{period,...g}; };
  const btypeYtd=bsplit(rows.filter(payYtd),'YTD');
  const btypePrev=bsplit(wsPrevPay,`W${prevW}`);
  const btypeCur =bsplit(wsCurPay, `W${curW}`);

  // ── Сплит источников ──────────────────────────────────────────────────────
  const srcSplitFn=(subset,period)=>{ const g={internal:{cnt:0,sum:0},marketing:{cnt:0,sum:0}}; for(const r of subset) if(isPaid(r)){const k=isInternalSource(r.SRC_ID)?'internal':'marketing';g[k].cnt++;g[k].sum+=r.OPP;} return{period,...g}; };
  const srcSplitYtd=srcSplitFn(rows.filter(payYtd),'YTD');
  const srcSplitPrev=srcSplitFn(wsPrevPay,`W${prevW}`);
  const srcSplitCur =srcSplitFn(wsCurPay, `W${curW}`);

  // ── Форматы ───────────────────────────────────────────────────────────────
  const fsplit=(subset,period)=>{ const g={}; for(const r of subset) if(isPaid(r)&&(r.IS_OOM||r.IS_KOM)){if(!g[r.FORMAT])g[r.FORMAT]={cnt:0,sum:0};g[r.FORMAT].cnt++;g[r.FORMAT].sum+=r.OPP;} return{period,...g}; };
  const fmtYtd=fsplit(rows.filter(payYtd),'YTD');
  const fmtPrev=fsplit(wsPrevPay,`W${prevW}`);

  // ── Тип обучения ──────────────────────────────────────────────────────────
  const edusplit=(subset,period)=>{ const g={}; for(const r of subset) if(isPaid(r)&&(r.IS_OOM||r.IS_KOM)){const e=EDU_TYPE_MAP[r.EDU_TYPE];if(e){if(!g[e])g[e]={cnt:0,sum:0};g[e].cnt++;g[e].sum+=r.OPP;}} return{period,...g}; };
  const eduYtd=edusplit(rows.filter(payYtd),'YTD');
  const eduPrev=edusplit(wsPrevPay,`W${prevW}`);
  const eduCur =edusplit(wsCurPay, `W${curW}`);

  // ── Регистрация ───────────────────────────────────────────────────────────
  const regRows=rows.filter(r=>String(r.SRC_ID)===REG_SRC_ID&&VALID_CATS.has(r.CAT_ID));
  const regYtd=calcRegFunnel(regRows.filter(r=>r.DC&&r.DC.getFullYear()===YEAR));
  const regAll=calcRegFunnel(regRows);

  // ── ТОП продуктов ─────────────────────────────────────────────────────────
  const prodData={};
  for (const r of rows) {
    if (r.IS_KOM) continue;                          // всё корпоративное, не только FORMAT==='КОМ'
    if (/\bILP\b/i.test(r.TITLE||'')) continue;      // конструктор (ILP где угодно в названии) — по просьбе Насти Ш.
    const key=r.PRODUCT.slice(0,90);
    if (!prodData[key]) prodData[key]={deals:0,sum:0,durs:[],fmt_ochn_cnt:0,fmt_ochn_sum:0,fmt_om_cnt:0,fmt_om_sum:0,fmt_sdo_cnt:0,fmt_sdo_sum:0};
    if (payYtd(r)) {
      prodData[key].deals++; prodData[key].sum+=r.OPP;
      if (r.FORMAT==='Очный') { prodData[key].fmt_ochn_cnt++; prodData[key].fmt_ochn_sum+=r.OPP; }
      else if (r.FORMAT==='Онлайн') { prodData[key].fmt_om_cnt++; prodData[key].fmt_om_sum+=r.OPP; }
      else { prodData[key].fmt_sdo_cnt++; prodData[key].fmt_sdo_sum+=r.OPP; }
      if (r.DC&&r.CL){const d=daysBetween(r.DC,r.CL);if(d>=0)prodData[key].durs.push(d);}
    }
  }
  const prodList=Object.entries(prodData).map(([name,d])=>{
    const avgC=d.deals?d.sum/d.deals:0, avgD=avg(d.durs);
    return{name,deals:d.deals,sum:d.sum,avg_check:Math.round(avgC),avg_won_days:Math.round(avgD*10)/10,share:0,_durs:d.durs,fmt_ochn_cnt:d.fmt_ochn_cnt,fmt_ochn_sum:d.fmt_ochn_sum,fmt_om_cnt:d.fmt_om_cnt,fmt_om_sum:d.fmt_om_sum,fmt_sdo_cnt:d.fmt_sdo_cnt,fmt_sdo_sum:d.fmt_sdo_sum};
  }).sort((a,b)=>b.sum-a.sum);
  const totalNonKom=prodList.reduce((s,p)=>s+p.sum,0);
  const TOP_N=20;
  const selected=prodList.slice(0,TOP_N).map(p=>{ const {_durs,...rest}=p; rest.share=totalNonKom?Math.round(p.sum/totalNonKom*100*10)/10:0; return rest; });
  const remaining=prodList.slice(TOP_N);
  const remSum=remaining.reduce((s,p)=>s+p.sum,0), remDeals=remaining.reduce((s,p)=>s+p.deals,0);
  const remDurs=remaining.flatMap(p=>p._durs);
  const remOchnCnt=remaining.reduce((s,p)=>s+p.fmt_ochn_cnt,0), remOchnSum=remaining.reduce((s,p)=>s+p.fmt_ochn_sum,0);
  const remOmCnt=remaining.reduce((s,p)=>s+p.fmt_om_cnt,0), remOmSum=remaining.reduce((s,p)=>s+p.fmt_om_sum,0);
  const remSdoCnt=remaining.reduce((s,p)=>s+p.fmt_sdo_cnt,0), remSdoSum=remaining.reduce((s,p)=>s+p.fmt_sdo_sum,0);
  const topProducts=[...selected,{
    name:`📦 Остальные (${remaining.length} продуктов)`,deals:remDeals,sum:remSum,
    avg_check:remDeals?Math.round(remSum/remDeals):0,avg_won_days:Math.round(avg(remDurs)*10)/10,
    share:totalNonKom?Math.round(remSum/totalNonKom*100*10)/10:0,
    fmt_ochn_cnt:remOchnCnt,fmt_ochn_sum:remOchnSum,
    fmt_om_cnt:remOmCnt,fmt_om_sum:remOmSum,
    fmt_sdo_cnt:remSdoCnt,fmt_sdo_sum:remSdoSum,
  }];

  // ── Менеджеры ─────────────────────────────────────────────────────────────
  const mgrYtd={}, mgrPrev={}, catYtd={};
  for (const r of rows) {
    if (!r.IS_OOM) continue;
    if (payYtd(r)) {
      if(!mgrYtd[r.MGR]) mgrYtd[r.MGR]={cnt:0,sum:0,lost:0};
      mgrYtd[r.MGR].cnt++; mgrYtd[r.MGR].sum+=r.OPP;
      if(!catYtd[r.CAT]) catYtd[r.CAT]={cnt:0,sum:0};
      catYtd[r.CAT].cnt++; catYtd[r.CAT].sum+=r.OPP;
      const pdM=getPayDate(r);
      if(pdM&&isoEq(pdM,YEAR,prevW)){if(!mgrPrev[r.MGR])mgrPrev[r.MGR]={cnt:0,sum:0,lost:0};mgrPrev[r.MGR].cnt++;mgrPrev[r.MGR].sum+=r.OPP;}
    } else if (r.SEM==='F'&&r.CL&&r.CL.getFullYear()===YEAR) {
      if(!mgrYtd[r.MGR]) mgrYtd[r.MGR]={cnt:0,sum:0,lost:0};
      mgrYtd[r.MGR].lost++;
      if(isoEq(r.CL,YEAR,prevW)){if(!mgrPrev[r.MGR])mgrPrev[r.MGR]={cnt:0,sum:0,lost:0};mgrPrev[r.MGR].lost++;}
    }
  }
  const mgrLeadsYtd={}, mgrLeadsPrev={};
  for (const l of leads) {
    const d=parseDt(l.DATE_CREATE); if(!d||d.getFullYear()!==YEAR) continue;
    const mgr=usersMap[String(l.ASSIGNED_BY_ID||'')]||String(l.ASSIGNED_BY_ID||'');
    mgrLeadsYtd[mgr]=(mgrLeadsYtd[mgr]||0)+1;
    if(isoEq(d,YEAR,prevW)) mgrLeadsPrev[mgr]=(mgrLeadsPrev[mgr]||0)+1;
  }
  const mgrRowFn=(name,d,lc)=>{ const w=d.cnt,s=d.sum,lo=d.lost,av=w?s/w:0,cv=(w+lo)?w/(w+lo)*100:0; return{name,leads:lc,won:w,lost:lo,conv_pct:Math.round(cv*10)/10,postupleniya:s,avg_check:Math.round(av)}; };
  const mgrTop=Object.entries(mgrYtd).map(([k,v])=>mgrRowFn(k,v,mgrLeadsYtd[k]||0)).sort((a,b)=>b.postupleniya-a.postupleniya).slice(0,30);
  const mgrPrevTop=Object.entries(mgrPrev).map(([k,v])=>mgrRowFn(k,v,mgrLeadsPrev[k]||0)).sort((a,b)=>b.postupleniya-a.postupleniya).slice(0,5);
  const catTop=Object.entries(catYtd).map(([k,v])=>[k,v.cnt,v.sum]).sort((a,b)=>b[2]-a[2]);

  // ── ТОП компаний ─────────────────────────────────────────────────────────
  const companyAgg={};
  for (const r of rows) {
    if (!isPaid(r)||getPayYear(r)!==YEAR) continue;
    let cid=String(r.COMPANY_ID||'0');
    if(cid==='0'&&cc[r.ID]) cid=String(cc[r.ID].COMPANY_ID||'0');
    if(!cid||cid==='0') continue;
    if(!companyAgg[cid]) companyAgg[cid]={sum:0,cnt:0,last:null,om_cnt:0,om_sum:0,kom_cnt:0,kom_sum:0};
    const pd=getPayDate(r);
    companyAgg[cid].sum+=r.OPP; companyAgg[cid].cnt++;
    // ОМ = открытое обучение (все форматы, кроме КОМ) — как на управленческом
    if(!r.IS_KOM){companyAgg[cid].om_cnt++;companyAgg[cid].om_sum+=r.OPP;}
    else {companyAgg[cid].kom_cnt++;companyAgg[cid].kom_sum+=r.OPP;}
    if(pd&&(!companyAgg[cid].last||pd>companyAgg[cid].last)) companyAgg[cid].last=pd;
  }
  const topCompanies=Object.entries(companyAgg).filter(([,d])=>d.sum>0).map(([cid,d])=>({
    id:cid, name:(companies[cid]||'—').slice(0,100), sum:d.sum, cnt:d.cnt,
    om_cnt:d.om_cnt, om_sum:d.om_sum, kom_cnt:d.kom_cnt, kom_sum:d.kom_sum,
    last_date:d.last?`${fmt2(d.last.getDate())}.${fmt2(d.last.getMonth()+1)}.${d.last.getFullYear()}`:'—',
    avg_check:d.cnt?Math.round(d.sum/d.cnt):0,
  })).sort((a,b)=>b.sum-a.sum).slice(0,20);

  // ── MBA ───────────────────────────────────────────────────────────────────
  const mbaMap={};
  for (const r of rows) {
    if (!isPaid(r)||getPayYear(r)!==YEAR) continue;
    const isMba=r.UF_CRM_1498466811.map(String).some(d=>MBA_DIRECTION_IDS.has(d))||hasMbaInTitle(r.TITLE);
    if (!isMba) continue;
    const mt=detectMbaType(r.TITLE); if(!mt) continue;
    if(!mbaMap[mt]) mbaMap[mt]={cnt:0,sum:0,deals:0,fmt_ochn_cnt:0,fmt_ochn_sum:0,fmt_om_cnt:0,fmt_om_sum:0,fmt_sdo_cnt:0,fmt_sdo_sum:0};
    mbaMap[mt].cnt++; mbaMap[mt].sum+=r.OPP; mbaMap[mt].deals++;
    if (r.FORMAT==='Очный') { mbaMap[mt].fmt_ochn_cnt++; mbaMap[mt].fmt_ochn_sum+=r.OPP; }
    else if (r.FORMAT==='Онлайн') { mbaMap[mt].fmt_om_cnt++; mbaMap[mt].fmt_om_sum+=r.OPP; }
    else { mbaMap[mt].fmt_sdo_cnt++; mbaMap[mt].fmt_sdo_sum+=r.OPP; }
  }
  const mbaRatingList=Object.entries(mbaMap).map(([type,v])=>({type,cnt:v.cnt,sum:v.sum,deals:v.deals,avg_check:v.cnt?Math.round(v.sum/v.cnt):0,fmt_ochn_cnt:v.fmt_ochn_cnt,fmt_ochn_sum:v.fmt_ochn_sum,fmt_om_cnt:v.fmt_om_cnt,fmt_om_sum:v.fmt_om_sum,fmt_sdo_cnt:v.fmt_sdo_cnt,fmt_sdo_sum:v.fmt_sdo_sum})).sort((a,b)=>b.sum-a.sum);

  // ── Созданные по категориям ───────────────────────────────────────────────
  const createdByCat={};
  for (const r of rows) {
    if(r.DC&&r.DC.getFullYear()>=2024&&r.OPP>=MIN_OPP) {
      if(!createdByCat[r.CAT]) createdByCat[r.CAT]={cnt:0};
      createdByCat[r.CAT].cnt++;
    }
  }
  const createdCatList=Object.entries(createdByCat).map(([k,v])=>[k,v.cnt]).sort((a,b)=>b[1]-a[1]);

  // ── Лиды YTD/prev/cur ─────────────────────────────────────────────────────
  const f=(fn)=>rows.filter(fn).length;
  const leadYtd    = f(r=>r.DC&&r.DC.getFullYear()===YEAR&&isAllLead(r));
  const oomLeads   = f(r=>r.DC&&r.DC.getFullYear()===YEAR&&isAllLead(r)&&r.IS_OOM);
  const komLeads   = f(r=>r.DC&&r.DC.getFullYear()===YEAR&&isAllLead(r)&&r.IS_KOM);
  const qualLeadYtd    = f(r=>r.DC&&r.DC.getFullYear()===YEAR&&isQualLead(r));
  const oomQualLeadYtd = f(r=>r.DC&&r.DC.getFullYear()===YEAR&&isQualLead(r)&&r.IS_OOM);
  const komQualLeadYtd = f(r=>r.DC&&r.DC.getFullYear()===YEAR&&isQualLead(r)&&r.IS_KOM);
  const leadPrev    = f(r=>r.DC&&r.DC.getFullYear()===YEAR&&isoEq(r.DC,YEAR,prevW)&&isAllLead(r));
  const leadCur     = f(r=>r.DC&&r.DC.getFullYear()===YEAR&&isoEq(r.DC,YEAR,curW) &&isAllLead(r));
  const oomLeadPrev = f(r=>r.DC&&r.DC.getFullYear()===YEAR&&isoEq(r.DC,YEAR,prevW)&&isAllLead(r)&&r.IS_OOM);
  const oomLeadCur  = f(r=>r.DC&&r.DC.getFullYear()===YEAR&&isoEq(r.DC,YEAR,curW) &&isAllLead(r)&&r.IS_OOM);
  const komLeadPrev = f(r=>r.DC&&r.DC.getFullYear()===YEAR&&isoEq(r.DC,YEAR,prevW)&&isAllLead(r)&&r.IS_KOM);
  const komLeadCur  = f(r=>r.DC&&r.DC.getFullYear()===YEAR&&isoEq(r.DC,YEAR,curW) &&isAllLead(r)&&r.IS_KOM);
  const qualLeadPrev = f(r=>r.DC&&r.DC.getFullYear()===YEAR&&isoEq(r.DC,YEAR,prevW)&&isQualLead(r));
  const qualLeadCur  = f(r=>r.DC&&r.DC.getFullYear()===YEAR&&isoEq(r.DC,YEAR,curW) &&isQualLead(r));
  const oomQualPrev  = f(r=>r.DC&&r.DC.getFullYear()===YEAR&&isoEq(r.DC,YEAR,prevW)&&isQualLead(r)&&r.IS_OOM);
  const oomQualCur   = f(r=>r.DC&&r.DC.getFullYear()===YEAR&&isoEq(r.DC,YEAR,curW) &&isQualLead(r)&&r.IS_OOM);
  const komQualPrev  = f(r=>r.DC&&r.DC.getFullYear()===YEAR&&isoEq(r.DC,YEAR,prevW)&&isQualLead(r)&&r.IS_KOM);
  const komQualCur   = f(r=>r.DC&&r.DC.getFullYear()===YEAR&&isoEq(r.DC,YEAR,curW) &&isQualLead(r)&&r.IS_KOM);

  emit({ type: 'step_done', idx: 0 });
  emit({ type: 'finalizing' });
  emit({ type: 'all_done' });

  const todayStr=`${TODAY.getFullYear()}-${fmt2(TODAY.getMonth()+1)}-${fmt2(TODAY.getDate())}`;

  return {
    today:todayStr, year:YEAR, fetched_at:fetchedAt,
    prev_week:prevW, cur_week:curW,
    prev_week_label:weekLabel(YEAR,prevW,TODAY), cur_week_label:weekLabel(YEAR,curW,TODAY),
    min_opp:MIN_OPP,
    ytd:mYtd, prev:mPrev, cur:mCur,
    kom_ytd:mKomYtd, kom_prev:mKomPrev, kom_cur:mKomCur,
    oom_ytd:mOomYtd, oom_prev:mOomPrev, oom_cur:mOomCur,
    leads_ytd:leadYtd, leads_prev:leadPrev, leads_cur:leadCur,
    qual_lead_ytd:qualLeadYtd, qual_lead_prev:qualLeadPrev, qual_lead_cur:qualLeadCur,
    oom_leads_ytd:oomLeads, kom_leads_ytd:komLeads,
    oom_qual_lead_ytd:oomQualLeadYtd, kom_qual_lead_ytd:komQualLeadYtd,
    oom_leads_prev:oomLeadPrev, oom_leads_cur:oomLeadCur,
    kom_leads_prev:komLeadPrev, kom_leads_cur:komLeadCur,
    oom_qual_prev:oomQualPrev, oom_qual_cur:oomQualCur,
    kom_qual_prev:komQualPrev, kom_qual_cur:komQualCur,
    weeks:Object.keys(weekly).map(Number).sort((a,b)=>a-b).map(w=>weekly[w]),
    months:Object.keys(monthly).map(Number).sort((a,b)=>a-b).map(m=>monthly[m]),
    prev_weeks:Object.keys(prevWeekly).map(Number).sort((a,b)=>a-b).map(w=>prevWeekly[w]),
    src_rating:srcRating,
    src_funnel:srcFunnelRating,
    src_split_ytd:srcSplitYtd, src_split_prev:srcSplitPrev, src_split_cur:srcSplitCur,
    btype_ytd:btypeYtd, btype_prev:btypePrev, btype_cur:btypeCur,
    fmt_ytd:fmtYtd, fmt_prev:fmtPrev,
    edu_ytd:eduYtd, edu_prev:eduPrev, edu_cur:eduCur,
    reg_ytd:regYtd, reg_all:regAll,
    top_products:topProducts, top_companies:topCompanies, company_names:companies,
    mgr_top:mgrTop, mgr_prev_top:mgrPrevTop,
    by_category:catTop, created_by_category:createdCatList,
    mba_rating:mbaRatingList,
  };
}
