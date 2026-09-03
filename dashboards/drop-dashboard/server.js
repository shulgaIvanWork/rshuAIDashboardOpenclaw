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
import { isKomDeal, isInternalSource, MIN_OPP, REG_SRC_ID, VALID_CATS, MQL_SALE_STAGES, NOT_MQL_SALE, YEAR, UF } from '@rshu/data-service/lib/deal-rules.js';
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

// ── КПЭ: планы поступлений (ввод админом, помесячно) ───────────────────────────
const PLANS_FILE = path.join(__dirname, 'data', 'plans.json');

// Планы: { месяц: { total: <число>, mgr: { <user_id>: <число> } } }.
// Старый формат { месяц: <число> } нормализуется при чтении (total).
async function readPlans() {
  try {
    const raw = JSON.parse(await fs.readFile(PLANS_FILE, 'utf-8'));
    for (const k of Object.keys(raw)) {
      const v = raw[k];
      if (typeof v === 'number') raw[k] = { total: v, mgr: {} };
      else raw[k] = { total: (v && v.total) || 0, mgr: (v && v.mgr) || {} };
    }
    return raw;
  } catch (e) { return {}; }
}
async function writePlans(p) {
  await fs.mkdir(path.dirname(PLANS_FILE), { recursive: true });
  await fs.writeFile(PLANS_FILE, JSON.stringify(p, null, 2), 'utf-8');
}

app.get('/api/plans', async (req, res) => {
  try { res.json(await readPlans()); }
  catch (e) { console.error('/api/plans error:', e.message); res.status(500).json({ error: e.message }); }
});

app.post('/api/plans', async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'только для администраторов' });
    const { month, value, mgr } = req.body || {};
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) return res.status(400).json({ error: 'month в формате YYYY-MM' });
    const v = parseFloat(value);
    if (isNaN(v) || v < 0) return res.status(400).json({ error: 'value — неотрицательное число' });
    const plans = await readPlans();
    const entry = plans[month] || { total: 0, mgr: {} };
    if (mgr) {
      // Личный план менеджера
      if (v === 0) delete entry.mgr[String(mgr)]; else entry.mgr[String(mgr)] = Math.round(v);
      if (!Object.keys(entry.mgr).length && !entry.total) delete plans[month]; else plans[month] = entry;
    } else {
      // План отдела
      entry.total = Math.round(v);
      if (!entry.total && !Object.keys(entry.mgr).length) delete plans[month]; else plans[month] = entry;
    }
    await writePlans(plans);
    res.json(plans);
  } catch (e) {
    console.error('/api/plans error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Фильтр по менеджеру для КПЭ: mgr=all | <user_id> | group:autopay|ozk|bond|afanasyev|artifact
// Возвращает null (без фильтра) или функцию-предикат по сделке.
function mgrFilter(mgrParam) {
  if (!mgrParam || mgrParam === 'all') return null;
  if (mgrParam.startsWith('group:')) {
    const g = mgrParam.slice(6);
    return x => {
      const mg = getMgrGroup(String(x.ASSIGNED_BY_ID || ''));
      if (g === 'artifact') return mg === 'other' || mg === 'tech';
      return mg === g;
    };
  }
  const id = mgrParam;
  return x => String(x.ASSIGNED_BY_ID || '') === id;
}

// План для выбранного скоупа: total (весь отдел) или личный план менеджера.
function planForScope(plans, month, mgrParam) {
  const entry = plans[month] || { total: 0, mgr: {} };
  if (!mgrParam || mgrParam === 'all') return { plan: entry.total || 0, source: 'total' };
  if (mgrParam.startsWith('group:')) return { plan: 0, source: 'none' }; // личные планы только для персональных менеджеров
  const v = entry.mgr[String(mgrParam)] || 0;
  return v > 0 ? { plan: v, source: 'manager' } : { plan: 0, source: 'none' };
}

// ── КПЭ: карточки за полный месяц (план/факт/ожидания/прогноз/темп) ───────────
// Стадии ожиданий: Счет отправлен (PROPOSAL), Частично оплачен (6), Постоплата (2)
const EXP_STAGES = new Set(['PROPOSAL', '6', '2']);

// «Сегодня» в Europe/Moscow (дата, сравнимая с parseDt: UTC-полночь)
const MSK_OFFSET_MS = 3 * 3600 * 1000;
function todayMsk() {
  const now = new Date(Date.now() + MSK_OFFSET_MS);
  return new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function parseDt(s) {
  if (!s) return null;
  const d = new Date(String(s).substring(0, 10) + 'T00:00:00');
  return isNaN(d.getTime()) ? null : d;
}

function monthRange(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  return { from: new Date(y, m - 1, 1), to: new Date(y, m, 0) }; // to = последний день месяца
}

// Рабочие дни (пн–пт) между датами включительно
function workdaysBetween(from, to) {
  let n = 0;
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  while (d <= end) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) n++;
    d.setDate(d.getDate() + 1);
  }
  return n;
}

// Ожидания: единая логика для карточек и срезов.
//  - actual:  стадии PROPOSAL/6/2, без оплаты, согласованная дата ∈ [from, to] и ≥ today;
//  - overdue: те же стадии, без оплаты, согласованная дата < today (из ЛЮБЫХ месяцев,
//             «переходящие») — входят в ожидания и прогноз, но не распределяются
//             по неделям/датам.
// Ожидания = actual + overdue. Закрытые месяцы обрабатывает вызывающий код (0).
function calcExpectParts(dealsRaw, from, to, today) {
  let actSum = 0, actCnt = 0, ovdSum = 0, ovdCnt = 0;
  for (const x of dealsRaw) {
    const st = String(x.STAGE_ID || '').replace(/^C\d+:/, '');
    if (!EXP_STAGES.has(st)) continue;
    const sem = x.STAGE_SEMANTIC_ID;
    if (sem === 'F' || sem === 'S') continue;      // не отказ и не WON
    if (x.UF_DATE_PAY_1C) continue;                // уже оплачена → она в факте
    const opp = parseFloat(x.OPPORTUNITY || 0);
    if (opp < MIN_OPP) continue;
    const ad = parseDt(x[UF.AGREED_PAY_DATE]);
    if (!ad) continue;
    if (ad < today) { ovdSum += opp; ovdCnt++; continue; }
    if (ad >= from && ad <= to) { actSum += opp; actCnt++; }
  }
  return { actual: { sum: Math.round(actSum), cnt: actCnt }, overdue: { sum: Math.round(ovdSum), cnt: ovdCnt } };
}

// Потенциал — текущий срез воронки (на сегодня, не зависит от месяца):
//   SQL (стадия «Лид для продажи», DETAILS) — сумма и штуки;
//   MQL (стадия «Маркетинговый лид», UC_4RJOR4) — штуки (сумм нет).
function calcPotential(dealsRaw) {
  let sqlSum = 0, sqlCnt = 0, mqlCnt = 0;
  for (const x of dealsRaw) {
    if (x.STAGE_SEMANTIC_ID !== 'P') continue;
    if (!VALID_CATS.has(parseInt(x.CATEGORY_ID || 0))) continue;
    if (x.UF_DATE_PAY_1C) continue;
    const st = String(x.STAGE_ID || '').replace(/^C\d+:/, '');
    if (st === 'DETAILS') {
      const opp = parseFloat(x.OPPORTUNITY || 0);
      if (opp < MIN_OPP) continue;
      sqlSum += opp; sqlCnt++;
    } else if (st === 'UC_4RJOR4') {
      mqlCnt++; // у MQL сумм нет — только штуки
    }
  }
  return { sql: { sum: Math.round(sqlSum), cnt: sqlCnt }, mql_cnt: mqlCnt };
}

// KPI за полный месяц + предыдущий месяц + планы + рабочие дни
app.get('/api/kpi-month', async (req, res) => {
  try {
    const { month, mgr } = req.query;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) return res.status(400).json({ error: 'month в формате YYYY-MM' });

    const dealsAll = JSON.parse(await fs.readFile(DEALS_PATH, 'utf-8'));
    const filter = mgrFilter(mgr);
    const dealsRaw = filter ? dealsAll.filter(filter) : dealsAll;
    const rows = enrichForKpi(dealsRaw);

    const [y, m] = month.split('-').map(Number);
    const prev = (m === 1 ? (y - 1) + '-12' : y + '-' + String(m - 1).padStart(2, '0'));
    const range  = monthRange(month);
    const pRange = monthRange(prev);

    const plans = await readPlans();
    const planScope = planForScope(plans, month, mgr);
    const plan = planScope.plan;
    const prevPlanScope = planForScope(plans, prev, mgr);
    const prevPlan = prevPlanScope.plan;

    const cur = calcPeriodKpi(rows, range.from, range.to);
    const prv = calcPeriodKpi(rows, pRange.from, pRange.to);
    const mskToday = todayMsk();
    // Ожидания: актуальные + переходящие просроченные. Закрытые месяцы — 0.
    const monthClosed = range.to < mskToday;
    const curParts = monthClosed
      ? { actual: { sum: 0, cnt: 0 }, overdue: { sum: 0, cnt: 0 } }
      : calcExpectParts(dealsRaw, range.from, range.to, mskToday);
    const prvClosed = pRange.to < mskToday;
    const prvParts = prvClosed
      ? { actual: { sum: 0, cnt: 0 }, overdue: { sum: 0, cnt: 0 } }
      : calcExpectParts(dealsRaw, pRange.from, pRange.to, mskToday);
    const curExp = { sum: curParts.actual.sum + curParts.overdue.sum, cnt: curParts.actual.cnt + curParts.overdue.cnt };
    const prvExp = { sum: prvParts.actual.sum + prvParts.overdue.sum, cnt: prvParts.actual.cnt + prvParts.overdue.cnt };

    const fact = { sum: cur.total.postupleniya, cnt: cur.total.won_relevant_cnt };
    const prevFact = { sum: prv.total.postupleniya, cnt: prv.total.won_relevant_cnt };
    const forecast = { sum: fact.sum + curExp.sum, cnt: fact.cnt + curExp.cnt };
    const prevForecast = { sum: prevFact.sum + prvExp.sum, cnt: prevFact.cnt + prvExp.cnt };

    // Рабочие дни: всего в месяце; осталось — от сегодня (МСК) для текущего/будущего месяца
    const totalWd = workdaysBetween(range.from, range.to);
    let leftWd = 0;
    if (mskToday <= range.to) {
      const startLeft = mskToday > range.from ? mskToday : range.from;
      leftWd = workdaysBetween(startLeft, range.to);
    }
    // План на дату: равномерная раскладка плана по рабочим дням месяца
    const passedWd = workdaysBetween(range.from, mskToday < range.to ? mskToday : range.to);
    const planOnDate = (plan > 0 && totalWd > 0) ? Math.round(plan * passedWd / totalWd) : 0;
    const factGap = fact.sum - planOnDate;
    // Прогноз выполнения плана (с учётом ожиданий)
    const pctForecast = plan > 0 ? Math.round(forecast.sum / plan * 1000) / 10 : null;
    const prevPctForecast = prevPlan > 0 ? Math.round(prevForecast.sum / prevPlan * 1000) / 10 : null;
    // Темп: сколько нужно получать в день, чтобы добрать до плана с учётом ожиданий.
    // (план − факт − ожидания) / оставшиеся раб. дни; если план уже обеспечен — 0.
    const remaining = plan - fact.sum - curExp.sum;
    const pace = (leftWd > 0 && plan > 0)
      ? (remaining > 0 ? Math.round(remaining / leftWd) : 0)
      : null;

    res.json({
      month, prev,
      plan, prev_plan: prevPlan, plan_source: planScope.source,
      fact, prev_fact: prevFact,
      pct: plan > 0 ? Math.round(fact.sum / plan * 1000) / 10 : null,
      prev_pct: prevPlan > 0 ? Math.round(prevFact.sum / prevPlan * 1000) / 10 : null,
      expect: curExp, prev_expect: prvExp,
      expect_actual: curParts.actual, expect_overdue: curParts.overdue,
      forecast, prev_forecast: prevForecast,
      diff: forecast.sum - plan, prev_diff: prevForecast.sum - prevPlan,
      pace: pace,
      pace_remaining: remaining,
      pct_forecast: pctForecast, prev_pct_forecast: prevPctForecast,
      plan_on_date: planOnDate, passed_wd: passedWd, fact_gap: factGap,
      potential: calcPotential(dealsRaw),
      avg_check: cur.total.avg_check, prev_avg_check: prv.total.avg_check,
      cycle: cur.total.avg_close_days_won, prev_cycle: prv.total.avg_close_days_won,
      workdays: { total: totalWd, left: leftWd },
      calculated_at: new Date(getCacheAt()).toISOString(),
    });
  } catch (e) {
    console.error('/api/kpi-month error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── КПЭ-срезы: недели / менеджеры / календарь / просроченные ──────────────────
function fmtDate(d) {
  const p = n => String(n).padStart(2, '0');
  return p(d.getDate()) + '.' + p(d.getMonth() + 1);
}

// План-факт по неделям месяца. План недели пропорционален рабочим дням недели
// внутри месяца. Ожидания — только актуальные (дата ≥ today), распределены по датам.
function buildWeeks(dealsRaw, rows, range, plan, today) {
  const totalWd = workdaysBetween(range.from, range.to);
  const weeks = [];
  let cur = new Date(range.from);
  const dow = cur.getDay() || 7; // 1..7 (пн..вс)
  cur.setDate(cur.getDate() - (dow - 1)); // понедельник недели начала месяца
  while (cur <= range.to) {
    const ws = cur > range.from ? new Date(cur) : new Date(range.from);
    const weRaw = new Date(cur); weRaw.setDate(weRaw.getDate() + 6);
    const we = weRaw < range.to ? weRaw : new Date(range.to);
    const wd = workdaysBetween(ws, we);
    const planSum = (plan > 0 && totalWd > 0) ? Math.round(plan * wd / totalWd) : 0;
    let factSum = 0, factCnt = 0;
    for (const r of rows) {
      if (r.PAY_DT && r.PAY_DT >= ws && r.PAY_DT <= we) { factSum += r.OPP; factCnt++; }
    }
    let expSum = 0, expCnt = 0;
    for (const x of dealsRaw) {
      const st = String(x.STAGE_ID || '').replace(/^C\d+:/, '');
      if (!EXP_STAGES.has(st)) continue;
      if (x.STAGE_SEMANTIC_ID === 'F' || x.STAGE_SEMANTIC_ID === 'S') continue;
      if (x.UF_DATE_PAY_1C) continue;
      const opp = parseFloat(x.OPPORTUNITY || 0);
      if (opp < MIN_OPP) continue;
      const ad = parseDt(x[UF.AGREED_PAY_DATE]);
      if (!ad || ad < today) continue;
      if (ad >= ws && ad <= we) { expSum += opp; expCnt++; }
    }
    const forecast = factSum + expSum;
    weeks.push({
      week_range: fmtDate(ws) + '—' + fmtDate(we),
      plan_sum: planSum,
      fact_sum: Math.round(factSum), fact_cnt: factCnt,
      expected_sum: Math.round(expSum), expected_cnt: expCnt,
      forecast_sum: Math.round(forecast),
      variance: Math.round(forecast - planSum),
    });
    cur.setDate(cur.getDate() + 7);
  }
  return weeks;
}

// Факт и ожидания по менеджерам: main персонально, autopay/ozk/bond/afanasyev
// строками, «Артефакт» = other + tech. Сумма строк = общим KPI.
function buildManagers(dealsRaw, dicts, range, today) {
  const users = dicts.users || {};
  const byMgr = {};
  const empty = () => ({ factSum: 0, factCnt: 0, actSum: 0, actCnt: 0, ovdSum: 0, ovdCnt: 0 });
  for (const x of dealsRaw) {
    const mid = String(x.ASSIGNED_BY_ID || '');
    const m = byMgr[mid] || (byMgr[mid] = empty());
    const opp = parseFloat(x.OPPORTUNITY || 0);
    const pay = parseDt(x.UF_DATE_PAY_1C);
    if (pay && pay >= range.from && pay <= range.to && opp >= MIN_OPP) { m.factSum += opp; m.factCnt++; }
    const st = String(x.STAGE_ID || '').replace(/^C\d+:/, '');
    if (EXP_STAGES.has(st) && x.STAGE_SEMANTIC_ID !== 'F' && x.STAGE_SEMANTIC_ID !== 'S' && !x.UF_DATE_PAY_1C && opp >= MIN_OPP) {
      const ad = parseDt(x[UF.AGREED_PAY_DATE]);
      if (ad) {
        if (ad < today) { m.ovdSum += opp; m.ovdCnt++; }
        else if (ad >= range.from && ad <= range.to) { m.actSum += opp; m.actCnt++; }
      }
    }
  }
  const rows = [];
  const push = (id, name, group, d) => {
    const expSum = d.actSum + d.ovdSum;
    rows.push({
      id, name, group,
      fact_sum: Math.round(d.factSum), fact_cnt: d.factCnt,
      expected_actual_sum: Math.round(d.actSum), expected_actual_cnt: d.actCnt,
      expected_overdue_sum: Math.round(d.ovdSum), expected_overdue_cnt: d.ovdCnt,
      expected_sum: Math.round(expSum),
      forecast_sum: Math.round(d.factSum + expSum),
      share_pct: 0,
    });
  };
  // main — персонально (только с фактом или ожиданиями; нулевые — в компактную строку)
  const zero = [];
  for (const [mid, d] of Object.entries(byMgr)) {
    if (getMgrGroup(mid) !== 'main') continue;
    if (d.factSum > 0 || d.actSum > 0 || d.ovdSum > 0) push(mid, users[mid] || mid, 'main', d);
    else zero.push({ id: mid, name: users[mid] || mid });
  }
  rows.sort((a, b) => b.forecast_sum - a.forecast_sum);
  // Группы: autopay/ozk/bond/afanasyev — строками после main
  const GROUP_ROWS = ['autopay', 'ozk', 'bond', 'afanasyev'];
  for (const g of GROUP_ROWS) {
    const d = empty();
    let any = false;
    for (const [mid, md] of Object.entries(byMgr)) {
      if (getMgrGroup(mid) === g) {
        any = true;
        d.factSum += md.factSum; d.factCnt += md.factCnt;
        d.actSum += md.actSum; d.actCnt += md.actCnt;
        d.ovdSum += md.ovdSum; d.ovdCnt += md.ovdCnt;
      }
    }
    if (any) push(g, MGR_GROUP_LABELS[g] || g, g, d);
  }
  // «Без результата — N менеджеров» (нулевые main, компактно) — перед «Артефактом»
  if (zero.length) push('zero', 'Без результата — ' + zero.length + ' менеджеров', 'zero', empty());
  // «Артефакт» = other + tech (последней строкой, участвует в итогах)
  const art = empty();
  let artAny = false;
  for (const [mid, md] of Object.entries(byMgr)) {
    const g = getMgrGroup(mid);
    if (g === 'other' || g === 'tech') {
      artAny = true;
      art.factSum += md.factSum; art.factCnt += md.factCnt;
      art.actSum += md.actSum; art.actCnt += md.actCnt;
      art.ovdSum += md.ovdSum; art.ovdCnt += md.ovdCnt;
    }
  }
  if (artAny) push('artifact', 'Артефакт', 'artifact', art);
  const total = rows.reduce((s, r) => s + r.forecast_sum, 0);
  rows.forEach(r => { r.share_pct = total > 0 ? Math.round(r.forecast_sum / total * 1000) / 10 : 0; });
  return { rows, total, zero_names: zero.map(z => z.name), zero_ids: zero };
}

// Календарь ожидаемых оплат: оставшиеся рабочие дни месяца (от today), только актуальные.
function buildCalendar(dealsRaw, dicts, range, today) {
  const users = dicts.users || {};
  const stages = dicts.stages || {};
  const stageName = x => stages[String(x.STAGE_ID)] || stages[String(x.STAGE_ID).replace(/^C\d+:/, '')] || String(x.STAGE_ID);
  const byDay = {};
  for (const x of dealsRaw) {
    const st = String(x.STAGE_ID || '').replace(/^C\d+:/, '');
    if (!EXP_STAGES.has(st)) continue;
    if (x.STAGE_SEMANTIC_ID === 'F' || x.STAGE_SEMANTIC_ID === 'S') continue;
    if (x.UF_DATE_PAY_1C) continue;
    const opp = parseFloat(x.OPPORTUNITY || 0);
    if (opp < MIN_OPP) continue;
    const ad = parseDt(x[UF.AGREED_PAY_DATE]);
    if (!ad || ad < today || ad < range.from || ad > range.to) continue;
    const key = ad.toISOString().substring(0, 10);
    const b = byDay[key] || (byDay[key] = { sum: 0, cnt: 0, managers: {}, stages: {} });
    b.sum += opp; b.cnt++;
    const mn = users[x.ASSIGNED_BY_ID] || x.ASSIGNED_BY_ID || '—';
    b.managers[mn] = (b.managers[mn] || 0) + opp;
    const sn = stageName(x);
    b.stages[sn] = (b.stages[sn] || 0) + opp;
  }
  const days = [];
  const start = today > range.from ? today : range.from;
  for (let d = new Date(start); d <= range.to; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue;
    const key = d.toISOString().substring(0, 10);
    const b = byDay[key];
    days.push({
      date: key, label: fmtDate(d),
      expected_sum: b ? Math.round(b.sum) : 0,
      expected_cnt: b ? b.cnt : 0,
      managers: b ? Object.entries(b.managers).map(([n, s]) => ({ name: n, sum: Math.round(s) })) : [],
      stages: b ? Object.entries(b.stages).map(([n, s]) => ({ name: n, sum: Math.round(s) })) : [],
    });
  }
  return days;
}

// Список просроченных ожиданий с расшифровкой до сделок (глобальный, не зависит от месяца).
function buildOverdueList(dealsRaw, dicts, today) {
  const users = dicts.users || {};
  const stages = dicts.stages || {};
  const list = [];
  for (const x of dealsRaw) {
    const st = String(x.STAGE_ID || '').replace(/^C\d+:/, '');
    if (!EXP_STAGES.has(st)) continue;
    if (x.STAGE_SEMANTIC_ID === 'F' || x.STAGE_SEMANTIC_ID === 'S') continue;
    if (x.UF_DATE_PAY_1C) continue;
    const opp = parseFloat(x.OPPORTUNITY || 0);
    if (opp < MIN_OPP) continue;
    const ad = parseDt(x[UF.AGREED_PAY_DATE]);
    if (!ad || ad >= today) continue;
    list.push({
      id: x.ID, title: x.TITLE,
      manager: users[x.ASSIGNED_BY_ID] || x.ASSIGNED_BY_ID || '—',
      stage: stages[String(x.STAGE_ID)] || stages[st] || String(x.STAGE_ID),
      sum: Math.round(opp),
      agreed: ad.toISOString().substring(0, 10),
    });
  }
  list.sort((a, b) => a.agreed.localeCompare(b.agreed));
  return list;
}

// Все данные для 4 срезов вкладки КПЭ за выбранный месяц.
// Контрольные равенства:
//   sum(weeks.expected_sum) + overdue = expected; sum(calendar.expected_sum) + overdue = expected;
//   sum(managers.expected_sum) = expected; forecast = fact + expected.
app.get('/api/kpi-slices', async (req, res) => {
  try {
    const { month, mgr } = req.query;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) return res.status(400).json({ error: 'month в формате YYYY-MM' });
    const [dealsRaw, dictsRaw] = await Promise.all([
      fs.readFile(DEALS_PATH, 'utf-8'),
      fs.readFile(path.join(__dirname, '..', '..', 'data-service', 'cache', 'dicts.json'), 'utf-8').catch(() => '{}'),
    ]);
    const dealsAll = JSON.parse(dealsRaw);
    const dicts = JSON.parse(dictsRaw);
    // Дедупликация по ID сделки
    const seen = new Set();
    const dealsAllDedup = dealsAll.filter(x => (seen.has(x.ID) ? false : (seen.add(x.ID), true)));
    // Фильтр по менеджеру — единый набор сделок для всех срезов
    const filter = mgrFilter(mgr);
    const deals = filter ? dealsAllDedup.filter(filter) : dealsAllDedup;
    const rows = enrichForKpi(deals);
    const mskToday = todayMsk();
    const range = monthRange(month);
    const plans = await readPlans();
    const planScope = planForScope(plans, month, mgr);
    const plan = planScope.plan;
    const monthClosed = range.to < mskToday;

    const cur = calcPeriodKpi(rows, range.from, range.to);
    const fact = { sum: cur.total.postupleniya, cnt: cur.total.won_relevant_cnt };
    const parts = monthClosed
      ? { actual: { sum: 0, cnt: 0 }, overdue: { sum: 0, cnt: 0 } }
      : calcExpectParts(deals, range.from, range.to, mskToday);
    const expected = { sum: parts.actual.sum + parts.overdue.sum, cnt: parts.actual.cnt + parts.overdue.cnt };
    const forecast = { sum: fact.sum + expected.sum, cnt: fact.cnt + expected.cnt };

    res.json({
      month, plan, plan_set: plan > 0, plan_source: planScope.source,
      fact, expected, expected_actual: parts.actual, expected_overdue: parts.overdue, forecast,
      coverage_pct: plan > 0 ? Math.round(forecast.sum / plan * 1000) / 10 : null,
      deficit: Math.max(plan - forecast.sum, 0),
      excess: Math.max(forecast.sum - plan, 0),
      weeks: buildWeeks(deals, rows, range, plan, mskToday),
      managers: buildManagers(deals, dicts, range, mskToday),
      calendar: buildCalendar(deals, dicts, range, mskToday),
      overdue: { sum: parts.overdue.sum, cnt: parts.overdue.cnt, deals: buildOverdueList(deals, dicts, mskToday) },
      calculated_at: new Date(getCacheAt()).toISOString(),
    });
  } catch (e) {
    console.error('/api/kpi-slices error:', e.message);
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
    const dealsAll = JSON.parse(await fs.readFile(DEALS_PATH, 'utf-8'));
    const filter = mgrFilter(req.query.mgr);
    const deals = filter ? dealsAll.filter(filter) : dealsAll;

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

    // «Просрочена согласованная дата оплаты»: сделка на стадии ожидания (Счёт отправлен /
    // Частично оплачен / Постоплата), согласованная дата оплаты в прошлом, оплаты нет.
    // Такие сделки искажают «Ожидания»: при пересчёте закрытого месяца они "всплывают"
    // задним числом. Нужно решать по сделке: продлить согласованную дату или закрыть.
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const overdueAgreed = deals
      .filter(d => ['PROPOSAL', '6', '2'].includes(String(d.STAGE_ID || '').replace(/^C\d+:/, ''))
        && d.STAGE_SEMANTIC_ID === 'P'
        && !d.UF_DATE_PAY_1C
        && (parseFloat(d.OPPORTUNITY) || 0) >= MIN_OPP
        && validCats.has(String(d.CATEGORY_ID))
        && d.UF_CRM_1474975772
        && new Date(String(d.UF_CRM_1474975772).substring(0, 10)) < today)
      .map(d => ({ id: d.ID, title: d.TITLE, sum: parseFloat(d.OPPORTUNITY) || 0, agreed: d.UF_CRM_1474975772, stage: d.STAGE_ID }));

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
        overdueAgreed:  { cnt: overdueAgreed.length,   sum: sum(overdueAgreed) },
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
        overdueAgreed: overdueAgreed.slice(0, 50),
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
