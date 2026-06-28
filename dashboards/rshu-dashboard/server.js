import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const _require = createRequire(import.meta.url);
const xlsx = _require('xlsx');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3001;
const DATA_DIR = path.join(__dirname, 'data');
const BITRIX_BASE = process.env.BITRIX_BASE || 'https://24.uprav.ru/rest/516/k1cdomfp4vd1kiql/';
const YEAR = 2026; // Основной дашборд — только 2026
// Для source-report используется yearFrom/yearTo

// Только эти воронки участвуют в подсчётах
const ALLOWED_CATEGORIES = ['0', '8', '19'];

// Поле даты отказа в Битрикс24
const UF_REFUSAL_DATE = 'UF_CRM_1753341391806';

await fs.mkdir(DATA_DIR, { recursive: true }).catch(() => {});

// --- Bitrix24 API helper ---
async function bitrixList(method, params = {}, onProgress) {
  const all = [];
  let start = 0;
  let total = 0;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 1800000); // 30 min timeout
  try {
  while (true) {
    const url = `${BITRIX_BASE + method}.json?start=${start}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: controller.signal,
    });
    if (!res.ok) { console.error(`${method} HTTP ${res.status}`); break; }
    const json = await res.json();
    if (!json || !json.result) break;
    const items = Array.isArray(json.result) ? json.result : Object.values(json.result);
    for (const item of items) all.push(item);
    total = json.total || total;
    console.log(`${method}: fetched ${all.length} of ${json.total || '?'}`);
    if (onProgress) onProgress(all.length, json.total || 0);
    if (json.next === undefined || json.next === null) break;
    start = json.next;
    await new Promise(r => setTimeout(r, 100));
  }
  } catch(e) {
    if (e.name === 'AbortError') {
      console.error(`${method} TIMEOUT, fetched ${all.length}`);
    } else {
      throw e;
    }
  } finally {
    clearTimeout(timeoutId);
  }
  return all;
}

// --- Поля для выборки сделки ---
function dealSelectFields() {
  return [
    'ID','TITLE','STAGE_ID','STAGE_SEMANTIC_ID','CATEGORY_ID',
    'OPPORTUNITY','CURRENCY_ID','DATE_CREATE','CLOSEDATE','CLOSED',
    'ASSIGNED_BY_ID','SOURCE_ID','PROBABILITY',
    'UF_DATE_PAY_1C',
    'UF_CRM_1474975772',  // Согл. дата оплаты
    'UF_CRM_1753272713011', // Дата Счет отправлен
    'UF_CRM_1697096074',    // Продукт (чистое название)
    'UF_FORMAT',             // Формат обучения (19042467=очный, 19042468=онлайн, 19042469=СДО, 19042498=КОМ)
    'UF_CRM_1744273716729', // Направление обучения
    UF_REFUSAL_DATE,
  ];
}

// --- Выгрузка сделок 2026 ---
async function fetchAllDeals() {
  console.log('Fetching deals from Bitrix24 (year ' + YEAR + ')...');
  const filterInYear = {
    '>=DATE_CREATE': `${YEAR}-01-01T00:00:00`,
    '<=DATE_CREATE': `${YEAR}-12-31T23:59:59`,
  };
  const select = dealSelectFields();

  const created = await bitrixList('crm.deal.list', {
    order: { ID: 'ASC' },
    filter: filterInYear,
    select,
  }, (loaded, total) => {
    dataState.loadingProgress = { phase: 'created', loaded, total };
  });

  const closed = await bitrixList('crm.deal.list', {
    order: { ID: 'ASC' },
    filter: { '>=CLOSEDATE': `${YEAR}-01-01T00:00:00`, '<=CLOSEDATE': `${YEAR}-12-31T23:59:59` },
    select,
  }, (loaded, total) => {
    dataState.loadingProgress = { phase: 'closed', loaded, total };
  });

  const map = new Map();
  for (const d of created) if (d?.ID) map.set(d.ID, d);
  for (const d of closed) if (d?.ID && !map.has(d.ID)) map.set(d.ID, d);
  let deals = Array.from(map.values());
  console.log(`Total unique deals: ${deals.length}`);

  const catCounts = {};
  for (const d of deals) {
    const k = d?.CATEGORY_ID;
    catCounts[k] = (catCounts[k] || 0) + 1;
  }
  console.log('CATEGORY_ID distribution:', JSON.stringify(catCounts));
  const beforeFilter = deals.length;
  deals = deals.filter(d => d && ALLOWED_CATEGORIES.includes(String(d.CATEGORY_ID)));
  console.log(`Filtered to allowed categories (Sale/Pre Sale/КОМ Sale): ${deals.length} of ${beforeFilter}`);
  return deals;
}

// --- Выгрузка сделок переходящего остатка (созданы до 2026, в работе, не оплачены, не в отказе) ---
async function fetchCarryOver() {
  console.log('Carry-over skipped for speed');
  return [];
}

async function fetchDicts() {
  const [categories, stages, sources, users] = await Promise.all([
    bitrixList('crm.category.list', { entityTypeId: 2 }).catch(e => (console.error('cats err:', e.message), [])),
    bitrixList('crm.dealcategory.stage.list').catch(e => (console.error('stages err:', e.message), [])),
    bitrixList('crm.status.list', { filter: { ENTITY_ID: 'SOURCE' } }).catch(e => (console.error('sources err:', e.message), [])),
    bitrixList('user.get').catch(e => (console.error('users err:', e.message), [])),
  ]);
  return { categories, stages, sources, users };
}

// --- ISO week ---
function isoWeek(d) {
  const tmp = new Date(d);
  tmp.setHours(0, 0, 0, 0);
  const day = (tmp.getDay() + 6) % 7;
  const thu = new Date(tmp);
  thu.setDate(thu.getDate() - day + 3);
  const firstThu = new Date(thu.getFullYear(), 0, 1);
  if (firstThu.getDay() !== 4) firstThu.setDate(firstThu.getDate() + ((4 - firstThu.getDay()) + 7) % 7);
  return 1 + Math.ceil((thu - firstThu) / 604800000);
}

// --- Является ли сделка оплаченной (по нашей логике) ---
function isPaid(d) {
  if (!d.UF_DATE_PAY_1C) return false;
  const amount = parseFloat(d.OPPORTUNITY || 0);
  if (amount === 0) return false;
  const isSaleCat = String(d.CATEGORY_ID) === '0';
  if (isSaleCat) {
    if (!(d.CLOSED === 'Y' && d.STAGE_SEMANTIC_ID === 'S')) return false;
  }
  return true;
}

// --- Дата оплаты сделки ---
function getPayDate(d) {
  if (!isPaid(d)) return null;
  return new Date(d.UF_DATE_PAY_1C.slice(0, 10));
}

// --- Дата проигрыша ---
function isLost(d) {
  return d.CLOSED === 'Y' && d.STAGE_SEMANTIC_ID === 'F' && !!d.CLOSEDATE;
}

function getLostDate(d) {
  if (!isLost(d)) return null;
  return new Date(d.CLOSEDATE.slice(0, 10));
}

// --- Отказ (дата отказа) ---
function hasRefusalBefore(d, dateThreshold) {
  const refusal = d[UF_REFUSAL_DATE];
  if (!refusal) return false;
  const refDate = new Date(refusal.slice(0, 10));
  return refDate <= dateThreshold;
}

// --- Сделка "в работе" на указанную дату ---
// Сделка считается в работе, если на указанную дату она:
// - создана (существует в CRM)
// - не выиграна (не закрыта успехом)
// - не проиграна (не закрыта провалом)
// - не оплачена из 1С
// - нет даты отказа
function isInWorkOnDate(d, date) {
  const dDate = new Date(date);
  
  // Если создана позже — не в работе
  if (!d.DATE_CREATE) return false;
  const createdDate = new Date(d.DATE_CREATE.slice(0, 10));
  if (createdDate > dDate) return false;
  
  // Технические (нулевая сумма) не считаем
  if (parseFloat(d.OPPORTUNITY || 0) === 0) return false;
  
  // Выиграна до этой даты → не в работе
  // (выигранная сделка — успех, независимо от наличия UF_DATE_PAY_1C)
  if (d.CLOSED === 'Y' && d.STAGE_SEMANTIC_ID === 'S' && d.CLOSEDATE) {
    const wonDate = new Date(d.CLOSEDATE.slice(0, 10));
    if (wonDate <= dDate) return false;
  }
  
  // Проиграна до этой даты → не в работе
  if (d.CLOSED === 'Y' && d.STAGE_SEMANTIC_ID === 'F' && d.CLOSEDATE) {
    const lostDate = new Date(d.CLOSEDATE.slice(0, 10));
    if (lostDate <= dDate) return false;
  }
  
  // Оплачена из 1С до этой даты → не в работе
  if (d.UF_DATE_PAY_1C) {
    const payDate = new Date(d.UF_DATE_PAY_1C.slice(0, 10));
    if (payDate <= dDate) return false;
  }
  
  // Отказ до этой даты → не в работе
  const refusal = d[UF_REFUSAL_DATE];
  if (refusal) {
    const refDate = new Date(refusal.slice(0, 10));
    if (refDate <= dDate) return false;
  }
  
  return true;
}

// ===== НОВЫЕ ПРАВИЛА (для вкладки «Апрель») =====

// Проверка: сделка-копия (исключаем из всех расчётов)
function isCopy(d) {
  return d && d.TITLE && /копи[яию]|copy/i.test(d.TITLE);
}

// Проверка: техническая оплата (Сейл + 0₽ + «Счёт оплачен»)
function isTechPaid(d) {
  if (!d) return false;
  return String(d.CATEGORY_ID) === '0'
    && parseFloat(d.OPPORTUNITY || 0) === 0
    && d.STAGE_SEMANTIC_ID === 'S';
}

// Новая логика «оплачено»: только Сейл, с суммой, с датой из 1С, статус S, не копия, не тех.
function isPaidNew(d) {
  if (!d) return false;
  if (isCopy(d)) return false;
  if (isTechPaid(d)) return false;
  // Sale + Pre Sale (кроме WON-копий)
  const cat = String(d.CATEGORY_ID);
  if (cat !== '0' && cat !== '8') return false;
  if (cat === '8' && d.STAGE_SEMANTIC_ID === 'S') return false;
  if (!d.UF_DATE_PAY_1C) return false;
  if (parseFloat(d.OPPORTUNITY || 0) <= 0) return false;
  if (!(d.CLOSED === 'Y' && d.STAGE_SEMANTIC_ID === 'S')) return false;
  return true;
}

// Сделка «в работе» на дату (новые правила: копии и тех. исключены)
function isInWorkOnDateNew(d, date) {
  if (!d) return false;
  if (isCopy(d)) return false;
  if (isTechPaid(d)) return false;

  const dDate = new Date(date);
  if (!d.DATE_CREATE) return false;
  const createdDate = new Date(d.DATE_CREATE.slice(0, 10));
  if (createdDate > dDate) return false;

  // Выиграна до этой даты → не в работе
  if (d.CLOSED === 'Y' && d.STAGE_SEMANTIC_ID === 'S' && d.CLOSEDATE) {
    const wonDate = new Date(d.CLOSEDATE.slice(0, 10));
    if (wonDate <= dDate) return false;
  }

  // Проиграна до этой даты → не в работе
  if (d.CLOSED === 'Y' && d.STAGE_SEMANTIC_ID === 'F' && d.CLOSEDATE) {
    const lostDate = new Date(d.CLOSEDATE.slice(0, 10));
    if (lostDate <= dDate) return false;
  }

  // Оплачена из 1С до этой даты → не в работе
  if (d.UF_DATE_PAY_1C) {
    const payDate = new Date(d.UF_DATE_PAY_1C.slice(0, 10));
    if (payDate <= dDate) return false;
  }

  // Отказ до этой даты → не в работе
  const refusal = d[UF_REFUSAL_DATE];
  if (refusal) {
    const refDate = new Date(refusal.slice(0, 10));
    if (refDate <= dDate) return false;
  }

  return true;
}

// --- Расчёт месяца по новым правилам ---
function calcMonthNew(year, month, allDealsArray, carryOverDealsArray) {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);
  const prevDay = new Date(monthStart);
  prevDay.setDate(prevDay.getDate() - 1);

  // Валидные сделки (не копии, не тех. оплаты)
  const validDeals = allDealsArray.filter(d => d && !isCopy(d) && !isTechPaid(d));

  // 1. Переходящий остаток на prevDay
  const inWorkOnPrev = validDeals.filter(d => {
    if (!d.DATE_CREATE) return false;
    const cd = new Date(d.DATE_CREATE.slice(0, 10));
    if (cd > prevDay) return false;
    return isInWorkOnDateNew(d, prevDay);
  });
  const carryInWork = (carryOverDealsArray || []).filter(d => isInWorkOnDateNew(d, prevDay));
  const prevMap = new Map();
  for (const d of [...inWorkOnPrev, ...carryInWork]) if (d?.ID) prevMap.set(d.ID, d);
  const prevDeals = Array.from(prevMap.values());

  // 2. Созданные за месяц (только Сейл)
  const createdInMonth = validDeals.filter(d => {
    if (!d.DATE_CREATE) return false;
    const cat = String(d.CATEGORY_ID);
    if (cat !== '0' && cat !== '8') return false;
    // Pre Sale: исключаем WON (копии)
    if (cat === '8' && d.STAGE_SEMANTIC_ID === 'S') return false;
    const cd = new Date(d.DATE_CREATE.slice(0, 10));
    return cd >= monthStart && cd <= monthEnd;
  });

  // 3. Оплаченные за месяц (только Сейл, новые правила)
  const paidInMonth = validDeals.filter(d => {
    if (!isPaidNew(d)) return false;
    const pd = new Date(d.UF_DATE_PAY_1C.slice(0, 10));
    return pd >= monthStart && pd <= monthEnd;
  });

  // 4. Проигранные («Закрыто и не реализовано») за месяц
  const lostInMonth = validDeals.filter(d => {
    if (!(d.CLOSED === 'Y' && d.STAGE_SEMANTIC_ID === 'F')) return false;
    if (!d.CLOSEDATE) return false;
    const ld = new Date(d.CLOSEDATE.slice(0, 10));
    return ld >= monthStart && ld <= monthEnd;
  });

  // 5. Ежедневная динамика поступлений (для нового графика)
  const dailyMap = new Map();
  for (let d = new Date(monthStart); d <= monthEnd; d.setDate(d.getDate() + 1)) {
    const dayStr = d.toISOString().slice(0, 10);
    const wk = isoWeek(d);
    const weekNum = wk;
    const monthDay = d.getDate();
    const weekday = d.getDay(); // 0=Sun, 1=Mon, ...
    dailyMap.set(dayStr, { date: dayStr, monthDay, weekNum, weekday, paidCnt: 0, paidSum: 0 });
  }
  for (const d of paidInMonth) {
    const pd = new Date(d.UF_DATE_PAY_1C.slice(0, 10));
    const dayStr = pd.toISOString().slice(0, 10);
    const day = dailyMap.get(dayStr);
    if (day) { day.paidCnt++; day.paidSum += parseFloat(d.OPPORTUNITY || 0); }
  }
  const dailyPaid = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  // Недели внутри месяца
  const weekMap = new Map();
  for (let d = new Date(monthStart); d <= monthEnd; d.setDate(d.getDate() + 1)) {
    const wk = isoWeek(d);
    if (!weekMap.has(wk)) {
      weekMap.set(wk, { key: wk, label: `W${String(wk).padStart(2, '0')}`, createdCnt: 0, createdSum: 0, paidCnt: 0, paidSum: 0, lostCnt: 0, lostSum: 0 });
    }
  }

  for (const d of createdInMonth) {
    if (!d.DATE_CREATE) continue;
    const cd = new Date(d.DATE_CREATE.slice(0, 10));
    const wk = isoWeek(cd);
    if (weekMap.has(wk)) { weekMap.get(wk).createdCnt++; weekMap.get(wk).createdSum += parseFloat(d.OPPORTUNITY || 0); }
  }
  for (const d of paidInMonth) {
    const pd = new Date(d.UF_DATE_PAY_1C.slice(0, 10));
    const wk = isoWeek(pd);
    if (weekMap.has(wk)) { weekMap.get(wk).paidCnt++; weekMap.get(wk).paidSum += parseFloat(d.OPPORTUNITY || 0); }
  }
  for (const d of lostInMonth) {
    const ld = new Date(d.CLOSEDATE.slice(0, 10));
    const wk = isoWeek(ld);
    if (weekMap.has(wk)) { weekMap.get(wk).lostCnt++; weekMap.get(wk).lostSum += parseFloat(d.OPPORTUNITY || 0); }
  }

  const sortedWeeks = Array.from(weekMap.values()).sort((a, b) => a.key - b.key);
  let cumCnt = prevDeals.length;
  let cumSum = prevDeals.reduce((s, d) => s + parseFloat(d.OPPORTUNITY || 0), 0);
  const periods = sortedWeeks.map(w => {
    const inWorkStartCnt = cumCnt;
    const inWorkStartSum = cumSum;
    cumCnt = cumCnt + w.createdCnt - w.paidCnt - w.lostCnt;
    cumSum = cumSum + w.createdSum - w.paidSum - w.lostSum;
    return { ...w, inWorkStartCnt, inWorkStartSum, avgCheck: w.paidCnt ? w.paidSum / w.paidCnt : 0, conversion: (w.paidCnt + w.lostCnt) ? (w.paidCnt / (w.paidCnt + w.lostCnt)) * 100 : 0 };
  });

  // KPI за месяц
  const totalPaidSum = paidInMonth.reduce((s, d) => s + parseFloat(d.OPPORTUNITY || 0), 0);
  const totalCreatedSum = createdInMonth.reduce((s, d) => s + parseFloat(d.OPPORTUNITY || 0), 0);
  const avgCheck = paidInMonth.length ? totalPaidSum / paidInMonth.length : 0;
  const conversion = (paidInMonth.length + lostInMonth.length) ? (paidInMonth.length / (paidInMonth.length + lostInMonth.length)) * 100 : 0;

  // Топ менеджеров (по новым правилам)
  const mgrMap = new Map();
  for (const d of paidInMonth) {
    const key = String(d.ASSIGNED_BY_ID || 0);
    const row = mgrMap.get(key) || { id: key, name: key, cnt: 0, sum: 0 };
    row.cnt++; row.sum += parseFloat(d.OPPORTUNITY || 0);
    mgrMap.set(key, row);
  }
  const usersMap = usersById(dictsCache?.users);
  for (const [id, row] of mgrMap) {
    const u = usersMap[id];
    if (u) row.name = [u.NAME, u.LAST_NAME].filter(Boolean).join(' ') || id;
  }
  const topManagers = Array.from(mgrMap.values()).sort((a, b) => b.sum - a.sum);

  const monthNames = ['','Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const currentInvCnt = createdInMonth.filter(d => {
    const sd = d.UF_CRM_1474975772;
    return sd && sd.length >= 10 && new Date(sd.slice(0, 10)) >= monthStart && new Date(sd.slice(0, 10)) <= monthEnd;
  }).length;
  const curPaidFromCreated = createdInMonth.filter(d => {
    if (!d.UF_DATE_PAY_1C) return false;
    const pd = new Date(d.UF_DATE_PAY_1C.slice(0, 10));
    return pd >= monthStart && pd <= monthEnd;
  }).length;
  return {
    year, month,
    monthName: monthNames[month],
    carryOver: { cnt: prevDeals.length, sum: prevDeals.reduce((s, d) => s + parseFloat(d.OPPORTUNITY || 0), 0) },
    periods,
    dailyPaid,
    totalCreatedCnt: createdInMonth.length,
    totalCreatedSum,
    // Разбивка по воронкам
    createdSale: createdInMonth.filter(d => String(d.CATEGORY_ID) === '0').length,
    createdSaleSum: createdInMonth.filter(d => String(d.CATEGORY_ID) === '0').reduce((s, d) => s + parseFloat(d.OPPORTUNITY || 0), 0),
    // Sale P (в работе) + PreSale P (на квалификации)
    createdInWork: createdInMonth.filter(d => d.STAGE_SEMANTIC_ID === 'P').length,
    createdInWorkSum: createdInMonth.filter(d => d.STAGE_SEMANTIC_ID === 'P').reduce((s, d) => s + parseFloat(d.OPPORTUNITY || 0), 0),
    // Sale все + PreSale P (в работе)
    saleAndPreSaleInWork: createdInMonth.filter(d => String(d.CATEGORY_ID) === '0' || (String(d.CATEGORY_ID) === '8' && d.STAGE_SEMANTIC_ID === 'P')).length,
    saleAndPreSaleInWorkSum: createdInMonth.filter(d => String(d.CATEGORY_ID) === '0' || (String(d.CATEGORY_ID) === '8' && d.STAGE_SEMANTIC_ID === 'P')).reduce((s, d) => s + parseFloat(d.OPPORTUNITY || 0), 0),
    // Нижняя часть песочных часов (расширение)
    // 5) В работе в Sale
    inWorkSale: createdInMonth.filter(d => String(d.CATEGORY_ID) === '0' && d.STAGE_SEMANTIC_ID === 'P').length,
    inWorkSaleSum: createdInMonth.filter(d => String(d.CATEGORY_ID) === '0' && d.STAGE_SEMANTIC_ID === 'P').reduce((s, d) => s + parseFloat(d.OPPORTUNITY || 0), 0),
    // 6) В работе + отказы в Sale
    inWorkAndLostSale: createdInMonth.filter(d => String(d.CATEGORY_ID) === '0' && (d.STAGE_SEMANTIC_ID === 'P' || d.STAGE_SEMANTIC_ID === 'F')).length,
    inWorkAndLostSaleSum: createdInMonth.filter(d => String(d.CATEGORY_ID) === '0' && (d.STAGE_SEMANTIC_ID === 'P' || d.STAGE_SEMANTIC_ID === 'F')).reduce((s, d) => s + parseFloat(d.OPPORTUNITY || 0), 0),
    // 7) Отказы PreSale
    lostPreSale: createdInMonth.filter(d => String(d.CATEGORY_ID) === '8' && d.STAGE_SEMANTIC_ID === 'F').length,
    lostPreSaleSum: createdInMonth.filter(d => String(d.CATEGORY_ID) === '8' && d.STAGE_SEMANTIC_ID === 'F').reduce((s, d) => s + parseFloat(d.OPPORTUNITY || 0), 0),
    totalPaidCnt: paidInMonth.length,
    totalPaidSum,
    // Оплачено из созданных в этом же периоде
    paidFromCreated: createdInMonth.filter(d => {
      if (!d.UF_DATE_PAY_1C) return false;
      const pd = new Date(d.UF_DATE_PAY_1C.slice(0, 10));
      return pd >= monthStart && pd <= monthEnd;
    }).length,
    paidFromCreatedSum: createdInMonth.filter(d => {
      if (!d.UF_DATE_PAY_1C) return false;
      const pd = new Date(d.UF_DATE_PAY_1C.slice(0, 10));
      return pd >= monthStart && pd <= monthEnd;
    }).reduce((s, d) => s + parseFloat(d.OPPORTUNITY || 0), 0),
    totalLostCnt: lostInMonth.length,
    totalLostSum: lostInMonth.reduce((s, d) => s + parseFloat(d.OPPORTUNITY || 0), 0),
    // Выставлены счета в периоде (только созданные в месяце + согл.дата оплаты в том же месяце)
    invoiceCnt: (() => {
      return createdInMonth.filter(d => {
        const sd = d.UF_CRM_1474975772;
        return sd && sd.length >= 10 && new Date(sd.slice(0, 10)) >= monthStart && new Date(sd.slice(0, 10)) <= monthEnd;
      });
    })().length,
    invoiceSum: (() => {
      return createdInMonth.filter(d => {
        const sd = d.UF_CRM_1474975772;
        return sd && sd.length >= 10 && new Date(sd.slice(0, 10)) >= monthStart && new Date(sd.slice(0, 10)) <= monthEnd;
      }).reduce((s, d) => s + parseFloat(d.OPPORTUNITY || 0), 0);
    })(),
    invoicePaid: (() => {
      return createdInMonth.filter(d => {
        const sd = d.UF_CRM_1474975772;
        if (!sd || sd.length < 10) return false;
        if (!(new Date(sd.slice(0, 10)) >= monthStart && new Date(sd.slice(0, 10)) <= monthEnd)) return false;
        return isPaidNew(d);
      }).length;
    })(),
    invoicePaidSum: (() => {
      return createdInMonth.filter(d => {
        const sd = d.UF_CRM_1474975772;
        if (!sd || sd.length < 10) return false;
        if (!(new Date(sd.slice(0, 10)) >= monthStart && new Date(sd.slice(0, 10)) <= monthEnd)) return false;
        return isPaidNew(d);
      }).reduce((s, d) => s + parseFloat(d.OPPORTUNITY || 0), 0);
    })(),
    avgCheck,
    conversionFact: paidInMonth.length && (paidInMonth.length + lostInMonth.length) ? paidInMonth.length / (paidInMonth.length + lostInMonth.length) * 100 : 0,
    // Цикл сделки (среднее дней от создания до оплаты)
    dealCycleDays: (() => {
      const paid = paidInMonth.filter(d => d.DATE_CREATE && d.UF_DATE_PAY_1C);
      if (!paid.length) return 0;
      const days = paid.map(d => {
        const created = new Date(d.DATE_CREATE.slice(0, 10));
        const paidDate = new Date(d.UF_DATE_PAY_1C.slice(0, 10));
        return (paidDate - created) / 86400000;
      });
      return Math.round(days.reduce((s, v) => s + v, 0) / days.length);
    })(),
    // Потенциальная конверсия с весами по стадиям
    conversionWeighted: (() => {
      const stageWeights = { 'PROPOSAL': 0.488, '2': 0.576, '6': 0.80 };
      const inWork = createdInMonth.filter(d => d.STAGE_SEMANTIC_ID === 'P');
      let weightedForecast = 0;
      for (const d of inWork) {
        const stage = d.STAGE_ID || '';
        const sum = parseFloat(d.OPPORTUNITY || 0);
        let weight = stageWeights[stage] || 0;
        if (!weight) {
          if (stage.endsWith(':PROPOSAL') || stage.includes('PROPOSAL')) weight = 0.488;
          else if (stage.endsWith(':6') || stage === '6') weight = 0.80;
          else if (stage === '2' || stage.endsWith(':2')) weight = 0.576;
          else weight = 0.3;
        }
        weightedForecast += sum * weight;
      }
      const totalPaidSum = paidInMonth.reduce((s, d) => s + parseFloat(d.OPPORTUNITY || 0), 0);
      const totalLostSum = lostInMonth.reduce((s, d) => s + parseFloat(d.OPPORTUNITY || 0), 0);
      const denom = totalPaidSum + totalLostSum + weightedForecast;
      return denom > 0 ? ((totalPaidSum + weightedForecast) / denom) * 100 : 0;
    })(),

    conversionPotential: (paidInMonth.length + lostInMonth.length + createdInMonth.filter(d => d.STAGE_SEMANTIC_ID === "P").length) ? (paidInMonth.length + createdInMonth.filter(d => d.STAGE_SEMANTIC_ID === "P").length) / (paidInMonth.length + lostInMonth.length + createdInMonth.filter(d => d.STAGE_SEMANTIC_ID === "P").length) * 100 : 0,
    avgCheckDelta: (() => {
      const prev = (month === 1 ? 12 : month - 1);
      const prevY = month === 1 ? year - 1 : year;
      const ps = new Date(prevY, prev - 1, 1);
      const pe = new Date(prevY, prev, 0);
      const prevP = validDeals.filter(d => {
        if (!isPaidNew(d) || !d.UF_DATE_PAY_1C) return false;
        const pd = new Date(d.UF_DATE_PAY_1C.slice(0, 10));
        return pd >= ps && pd <= pe;
      });
      const prevPsum = prevP.reduce((s, d) => s + parseFloat(d.OPPORTUNITY || 0), 0);
      const prevPcnt = prevP.length;
      const prevAvg = prevPcnt ? prevPsum / prevPcnt : 0;
      
      // Созданные за предыдущий месяц
      const prevC = validDeals.filter(d => {
        if (!d.DATE_CREATE) return false;
        const cat = String(d.CATEGORY_ID);
        if (cat !== '0' && cat !== '8') return false;
        if (cat === '8' && d.STAGE_SEMANTIC_ID === 'S') return false;
        const cd = new Date(d.DATE_CREATE.slice(0, 10));
        return cd >= ps && cd <= pe;
      });
      const prevCs = prevC.reduce((s, d) => s + parseFloat(d.OPPORTUNITY || 0), 0);
      const prevCc = prevC.length;
      
      // Проигранные за предыдущий месяц
      const prevL = validDeals.filter(d => {
        if (!d.CLOSEDATE) return false;
        if (d.STAGE_SEMANTIC_ID !== 'F') return false;
        const ld = new Date(d.CLOSEDATE.slice(0, 10));
        return ld >= ps && ld <= pe;
      });
      const prevLc = prevL.length;
      const prevConvFact = (prevPcnt + prevLc) ? (prevPcnt / (prevPcnt + prevLc)) * 100 : 0;
      
      // Цикл предыдущего месяца
      const prevCycleArr = prevP.filter(d => d.DATE_CREATE);
      const prevCycleDays = prevCycleArr.length ? Math.round(prevCycleArr.reduce((s, d) => {
        const cr = new Date(d.DATE_CREATE.slice(0, 10));
        const pd = new Date(d.UF_DATE_PAY_1C.slice(0, 10));
        return s + (pd - cr) / 86400000;
      }, 0) / prevCycleArr.length) : 0;
      
      return prevAvg > 0 ? ((avgCheck - prevAvg) / prevAvg * 100) : 0;
    })(),
    // Дельта поступлений к предыдущему месяцу
    paidSumDelta: (() => {
      const prev = (month === 1 ? 12 : month - 1);
      const prevY = month === 1 ? year - 1 : year;
      const ps = new Date(prevY, prev - 1, 1);
      const pe = new Date(prevY, prev, 0);
      const prevP = validDeals.filter(d => {
        if (!isPaidNew(d) || !d.UF_DATE_PAY_1C) return false;
        const pd = new Date(d.UF_DATE_PAY_1C.slice(0, 10));
        return pd >= ps && pd <= pe;
      });
      const prevSum = prevP.reduce((s, d) => s + parseFloat(d.OPPORTUNITY || 0), 0);
      return prevSum > 0 ? ((totalPaidSum - prevSum) / prevSum * 100) : 0;
    })(),
    // Дельта оплат (шт) к предыдущему месяцу
    paidCntDelta: (() => {
      const prev = (month === 1 ? 12 : month - 1);
      const prevY = month === 1 ? year - 1 : year;
      const ps = new Date(prevY, prev - 1, 1);
      const pe = new Date(prevY, prev, 0);
      const prevCnt = validDeals.filter(d => {
        if (!isPaidNew(d) || !d.UF_DATE_PAY_1C) return false;
        const pd = new Date(d.UF_DATE_PAY_1C.slice(0, 10));
        return pd >= ps && pd <= pe;
      }).length;
      return prevCnt > 0 ? ((paidInMonth.length - prevCnt) / prevCnt * 100) : 0;
    })(),
    // Дельта конверсии факт к предыдущему месяцу
    convFactDelta: (() => {
      const prev = (month === 1 ? 12 : month - 1);
      const prevY = month === 1 ? year - 1 : year;
      const ps = new Date(prevY, prev - 1, 1);
      const pe = new Date(prevY, prev, 0);
      const prevP = validDeals.filter(d => {
        if (!isPaidNew(d) || !d.UF_DATE_PAY_1C) return false;
        const pd = new Date(d.UF_DATE_PAY_1C.slice(0, 10));
        return pd >= ps && pd <= pe;
      }).length;
      const prevL = validDeals.filter(d => {
        if (!d.CLOSEDATE) return false;
        if (d.STAGE_SEMANTIC_ID !== 'F') return false;
        const ld = new Date(d.CLOSEDATE.slice(0, 10));
        return ld >= ps && ld <= pe;
      }).length;
      const prevConv = (prevP + prevL) ? (prevP / (prevP + prevL)) * 100 : 0;
      const currentConv = (paidInMonth.length + lostInMonth.length) ? (paidInMonth.length / (paidInMonth.length + lostInMonth.length)) * 100 : 0;
      return prevConv > 0 ? ((currentConv - prevConv) / prevConv * 100) : 0;
    })(),
    // Дельта цикла сделки к предыдущему месяцу
    dealCycleDelta: (() => {
      const prev = (month === 1 ? 12 : month - 1);
      const prevY = month === 1 ? year - 1 : year;
      const ps = new Date(prevY, prev - 1, 1);
      const pe = new Date(prevY, prev, 0);
      const prevP = validDeals.filter(d => {
        if (!isPaidNew(d) || !d.UF_DATE_PAY_1C) return false;
        const pd = new Date(d.UF_DATE_PAY_1C.slice(0, 10));
        return pd >= ps && pd <= pe;
      });
      const prevCycleArr = prevP.filter(d => d.DATE_CREATE);
      const prevCycle = prevCycleArr.length ? Math.round(prevCycleArr.reduce((s, d) => {
        const cr = new Date(d.DATE_CREATE.slice(0, 10));
        const pd = new Date(d.UF_DATE_PAY_1C.slice(0, 10));
        return s + (pd - cr) / 86400000;
      }, 0) / prevCycleArr.length) : 0;
      const currentCycle = (() => {
        const paid = paidInMonth.filter(d => d.DATE_CREATE && d.UF_DATE_PAY_1C);
        if (!paid.length) return 0;
        const days = paid.map(d => {
          const cr = new Date(d.DATE_CREATE.slice(0, 10));
          const pd = new Date(d.UF_DATE_PAY_1C.slice(0, 10));
          return (pd - cr) / 86400000;
        });
        return Math.round(days.reduce((s, v) => s + v, 0) / days.length);
      })();
      return prevCycle > 0 ? ((currentCycle - prevCycle) / prevCycle * 100) : 0;
    })(),
    // Дельта кол-ва созданных к предыдущему месяцу
    createdCntDelta: (() => {
      const prev = (month === 1 ? 12 : month - 1);
      const prevY = month === 1 ? year - 1 : year;
      const ps = new Date(prevY, prev - 1, 1);
      const pe = new Date(prevY, prev, 0);
      const prevC = validDeals.filter(d => {
        if (!d.DATE_CREATE) return false;
        const cat = String(d.CATEGORY_ID);
        if (cat !== '0' && cat !== '8') return false;
        if (cat === '8' && d.STAGE_SEMANTIC_ID === 'S') return false;
        const cd = new Date(d.DATE_CREATE.slice(0, 10));
        return cd >= ps && cd <= pe;
      });
      const prevCnt = prevC.length;
      return prevCnt > 0 ? ((createdInMonth.length - prevCnt) / prevCnt * 100) : 0;
    })(),
    // Дельта суммы созданных к предыдущему месяцу
    createdSumDelta: (() => {
      const prev = (month === 1 ? 12 : month - 1);
      const prevY = month === 1 ? year - 1 : year;
      const ps = new Date(prevY, prev - 1, 1);
      const pe = new Date(prevY, prev, 0);
      const prevC = validDeals.filter(d => {
        if (!d.DATE_CREATE) return false;
        const cat = String(d.CATEGORY_ID);
        if (cat !== '0' && cat !== '8') return false;
        if (cat === '8' && d.STAGE_SEMANTIC_ID === 'S') return false;
        const cd = new Date(d.DATE_CREATE.slice(0, 10));
        return cd >= ps && cd <= pe;
      });
      const prevSum = prevC.reduce((s, d) => s + parseFloat(d.OPPORTUNITY || 0), 0);
      return prevSum > 0 ? ((totalCreatedSum - prevSum) / prevSum * 100) : 0;
    })(),
    // Дельта выставленных счетов к предыдущему месяцу
    invCntDelta: (() => {
      const prev = (month === 1 ? 12 : month - 1);
      const prevY = month === 1 ? year - 1 : year;
      const ps = new Date(prevY, prev - 1, 1);
      const pe = new Date(prevY, prev, 0);
      const prevC = validDeals.filter(d => {
        if (!d.DATE_CREATE) return false;
        const cat = String(d.CATEGORY_ID);
        if (cat !== '0' && cat !== '8') return false;
        if (cat === '8' && d.STAGE_SEMANTIC_ID === 'S') return false;
        const cd = new Date(d.DATE_CREATE.slice(0, 10));
        return cd >= ps && cd <= pe;
      });
      const prevInvCnt = prevC.filter(d => {
        const sd = d.UF_CRM_1474975772;
        if (!sd || sd.length < 10) return false;
        return new Date(sd.slice(0, 10)) >= ps && new Date(sd.slice(0, 10)) <= pe;
      }).length;
      return prevInvCnt > 0 ? ((currentInvCnt - prevInvCnt) / prevInvCnt * 100) : 0;
    })(),
    // Дельта оплаченных из созданных в периоде
    paidFromCreatedCntDelta: (() => {
      const prev = (month === 1 ? 12 : month - 1);
      const prevY = month === 1 ? year - 1 : year;
      const ps = new Date(prevY, prev - 1, 1);
      const pe = new Date(prevY, prev, 0);
      const prevC = validDeals.filter(d => {
        if (!d.DATE_CREATE) return false;
        const cat = String(d.CATEGORY_ID);
        if (cat !== '0' && cat !== '8') return false;
        if (cat === '8' && d.STAGE_SEMANTIC_ID === 'S') return false;
        const cd = new Date(d.DATE_CREATE.slice(0, 10));
        return cd >= ps && cd <= pe;
      });
      const prevPaidCnt = prevC.filter(d => {
        if (!d.UF_DATE_PAY_1C) return false;
        const pd = new Date(d.UF_DATE_PAY_1C.slice(0, 10));
        return pd >= ps && pd <= pe;
      }).length;
      return prevPaidCnt > 0 ? ((curPaidFromCreated - prevPaidCnt) / prevPaidCnt * 100) : 0;
    })(),
    conversion,
    topManagers,
    dealsCount: validDeals.length,
    carryOverCount: prevDeals.length,
    
    // Объём воронки Sale в работе сейчас (все стадии, кроме WON/F/оплаты/отказа)
    funnelVolume: (() => {
      const allSale = (allDealsArray || []).filter(d => d && String(d.CATEGORY_ID) === '0');
      const inWork = allSale.filter(d => {
        if (d.STAGE_ID === 'WON') return false;
        if (d.STAGE_SEMANTIC_ID === 'F') return false;
        if (d.UF_DATE_PAY_1C) return false;
        if (d.UF_CRM_1753341391806) return false;
        return true;
      });
      const stages = {};
      const stageNames = {'UC_4RJOR4':'MQL','DETAILS':'SQL','PROPOSAL':'Счёт','2':'Постоплата','6':'Частич.','UC_838R2R':'Консульт.','UC_STZB49':'Взят','UC_W6SCHG':'След год','NEW':'Новый'};
      for (const d of inWork) {
        const s = d.STAGE_ID || '?';
        if (!stages[s]) stages[s] = {stageId: s, name: stageNames[s] || s, cnt: 0, sum: 0};
        stages[s].cnt++;
        stages[s].sum += parseFloat(d.OPPORTUNITY || 0);
      }
      // Менеджеры по объёму в работе
      const mgrMap = {};
      for (const d of inWork) {
        const mid = String(d.ASSIGNED_BY_ID || '0');
        if (!mgrMap[mid]) mgrMap[mid] = {id: mid, name: mid, dealCnt: 0, sum: 0};
        mgrMap[mid].dealCnt++;
        mgrMap[mid].sum += parseFloat(d.OPPORTUNITY || 0);
      }
      const usersMap = usersById(dictsCache?.users);
      for (const [id, row] of Object.entries(mgrMap)) {
        const u = usersMap[id];
        if (u) row.name = [u.NAME, u.LAST_NAME].filter(Boolean).join(' ') || id;
      }
      return {
        totalCnt: inWork.length,
        totalSum: inWork.reduce((s, d) => s + parseFloat(d.OPPORTUNITY || 0), 0),
        stages: Object.values(stages).sort((a, b) => {
          const order = {'NEW':1,'UC_VKPN0N':2,'UC_1YW3V2':3,'UC_STZB49':4,'UC_838R2R':5,'UC_4RJOR4':6,'DETAILS':7,'PROPOSAL':8,'6':9,'2':10,'UC_W6SCHG':11,'UC_670ME2':12};
          return (order[a.stageId] || 99) - (order[b.stageId] || 99);
        }),
        groups: (() => {
          const g = {'Вход в воронку':['NEW','UC_VKPN0N','UC_1YW3V2'],'Квалификация':['UC_STZB49','UC_838R2R'],'Маркетинг':['UC_4RJOR4'],'Продажи':['DETAILS','PROPOSAL'],'Оплата':['6','2'],'Прочее':['UC_W6SCHG','UC_670ME2']};
          const r = [];
          for (const [nm,ids] of Object.entries(g)) {
            let c=0,s=0;
            for (const d of inWork) { if (ids.includes(d.STAGE_ID||'')) { c++; s+=parseFloat(d.OPPORTUNITY||0); } }
            if (c>0) r.push({name:nm,cnt:c,sum:s});
          }
          return r;
        })(),
        managers: Object.values(mgrMap).sort((a, b) => b.dealCnt - a.dealCnt).slice(0, 20),
      };
    })(),
  };
}

// --- Период-ключ ---
function periodKey(d, type) {
  if (type === 'month') {
    return d.getFullYear() * 100 + (d.getMonth() + 1); // 202501, 202601, ...
  }
  return isoWeek(d); // неделя (только 2026)
}

function periodLabel(key, type) {
  if (type === 'month') {
    const m = key % 100;
    const months = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
    return months[m - 1] || key;
  }
  return `W${String(key).padStart(2, '0')}`;
}

function periodSortKey(key, type) {
  return key;
}

// --- Границы периода ---
function periodBounds(key, type) {
  if (type === 'month') {
    const m = key % 100;
    const y = Math.floor(key / 100);
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 0); // last day of month
    return { start, end };
  }
  // неделя (ключ = номер недели)
  const mon = new Date(YEAR, 0, 1 + (key - 1) * 7);
  const sun = new Date(mon);
  sun.setDate(sun.getDate() + 6);
  return { start: mon, end: sun };
}

// --- Агрегация с переходящим остатком ---
function aggregateWithCarryOver(deals, carryOverDeals, periodType = 'week') {
  if (!deals || !deals.length) return { periods: [], carryOver: { cnt: 0, sum: 0 } };

  // Собираем все уникальные периоды из сделок
  const periodSet = new Set();
  
  // Кэш сделок по ID для быстрого доступа
  const dealsMap = new Map();
  for (const d of deals) if (d?.ID) dealsMap.set(d.ID, d);

  // Для каждой сделки определяем периоды событий
  // Созданные
  for (const d of deals) {
    if (!d?.DATE_CREATE) continue;
    const cd = new Date(d.DATE_CREATE.slice(0, 10));
    if (cd.getFullYear() === YEAR) {
      periodSet.add(periodKey(cd, periodType));
    }
  }

  // Оплаченные
  for (const d of deals) {
    if (!isPaid(d)) continue;
    const pd = getPayDate(d);
    if (pd && pd.getFullYear() === YEAR) {
      periodSet.add(periodKey(pd, periodType));
    }
  }

  // Проигранные
  for (const d of deals) {
    if (!isLost(d)) continue;
    const ld = getLostDate(d);
    if (ld && ld.getFullYear() === YEAR) {
      periodSet.add(periodKey(ld, periodType));
    }
  }

  // Сортируем периоды
  const sortedPeriods = Array.from(periodSet).sort((a, b) => periodSortKey(a, periodType) - periodSortKey(b, periodType));

  // Вычисляем данные для каждого периода
  const periods = [];
  let cumulativeCarryCnt = carryOverDeals?.length || 0;
  let cumulativeCarrySum = carryOverDeals?.reduce((s, d) => s + parseFloat(d.OPPORTUNITY || 0), 0) || 0;

  // Для каждого периода: подсчитаем созданные, оплаченные, проигранные
  for (const key of sortedPeriods) {
    const label = periodLabel(key, periodType);
    const { start: periodStart, end: periodEnd } = periodBounds(key, periodType);

    let createdCnt = 0, createdSum = 0;
    let paidCnt = 0, paidSum = 0;
    let lostCnt = 0, lostSum = 0;

    for (const d of deals) {
      if (!d) continue;

      // Созданные
      if (d.DATE_CREATE) {
        const cd = new Date(d.DATE_CREATE.slice(0, 10));
        if (cd.getFullYear() === YEAR && periodKey(cd, periodType) === key) {
          const amt = parseFloat(d.OPPORTUNITY || 0);
          if (amt > 0) { createdCnt++; createdSum += amt; }
        }
      }

      // Оплаченные
      if (isPaid(d)) {
        const pd = getPayDate(d);
        if (pd && pd.getFullYear() === YEAR && periodKey(pd, periodType) === key) {
          paidCnt++; paidSum += parseFloat(d.OPPORTUNITY || 0);
        }
      }

      // Проигранные
      if (isLost(d)) {
        const ld = getLostDate(d);
        if (ld && ld.getFullYear() === YEAR && periodKey(ld, periodType) === key) {
          lostCnt++; lostSum += parseFloat(d.OPPORTUNITY || 0);
        }
      }
    }

    // "В работе на начало периода" = переходящий остаток с предыдущих периодов
    const inWorkStartCnt = cumulativeCarryCnt;
    const inWorkStartSum = cumulativeCarrySum;

    // Обновляем кумулятивный остаток для следующего периода
    cumulativeCarryCnt = cumulativeCarryCnt + createdCnt - paidCnt - lostCnt;
    cumulativeCarrySum = cumulativeCarrySum + createdSum - paidSum - lostSum;

    periods.push({
      key,
      label,
      inWorkStartCnt,
      inWorkStartSum,
      createdCnt,
      createdSum,
      paidCnt,
      paidSum,
      lostCnt,
      lostSum,
      avgCheck: paidCnt ? paidSum / paidCnt : 0,
      conversion: (paidCnt + lostCnt) ? (paidCnt / (paidCnt + lostCnt)) * 100 : 0,
    });
  }

  const carryOverCnt = carryOverDeals?.length || 0;
  const carryOverSum = carryOverDeals?.reduce((s, d) => s + parseFloat(d.OPPORTUNITY || 0), 0) || 0;

  return { periods, carryOver: { cnt: carryOverCnt, sum: carryOverSum } };
}

// --- KPI ---
function calcKpi(periods) {
  if (!periods || !periods.length) {
    return { paid_sum: 0, paid_cnt: 0, lost_cnt: 0, created_sum: 0, created_cnt: 0, avgCheck: 0, conversion: 0, bestLabel: null, bestSum: 0, lastSum: 0, lastCnt: 0, delta: 0 };
  }
  let paid_sum = 0, paid_cnt = 0, lost_cnt = 0, created_sum = 0, created_cnt = 0;
  for (const p of periods) {
    if (!p) continue;
    paid_sum += p.paidSum || 0; paid_cnt += p.paidCnt || 0;
    lost_cnt += p.lostCnt || 0; created_sum += p.createdSum || 0; created_cnt += p.createdCnt || 0;
  }
  const avgCheck = paid_cnt ? paid_sum / paid_cnt : 0;
  const conversion = (paid_cnt + lost_cnt) ? (paid_cnt / (paid_cnt + lost_cnt)) * 100 : 0;
  let best = null, bestS = 0;
  for (const p of periods) if (p && (p.paidSum || 0) > bestS) { best = p.label; bestS = p.paidSum || 0; }
  const last = periods[periods.length - 1] || {};
  const prev = periods[periods.length - 2] || null;
  const delta = prev ? (((last.paidSum || 0) - (prev.paidSum || 0)) / ((prev.paidSum || 1))) * 100 : 0;
  return { paid_sum, paid_cnt, lost_cnt, created_sum, created_cnt, avgCheck, conversion, bestLabel: best, bestSum: bestS, lastSum: last.paidSum || 0, lastCnt: last.paidCnt || 0, delta };
}

// --- Топ менеджеров (по оплаченным сделкам) ---
function topByPaid(deals, usersDict) {
  if (!deals || !deals.length) return [];
  const map = new Map();
  for (const d of deals) {
    if (!d) continue;
    if (!isPaid(d)) continue;
    const pd = getPayDate(d);
    if (!pd || pd.getFullYear() !== YEAR) continue;

    const key = String(d.ASSIGNED_BY_ID || 0);
    const row = map.get(key) || { id: key, name: key, cnt: 0, sum: 0 };
    row.cnt++;
    row.sum += parseFloat(d.OPPORTUNITY || 0);
    map.set(key, row);
  }

  if (usersDict) {
    for (const [id, row] of map) {
      const u = usersDict[id];
      if (u) {
        const nameParts = [u.NAME, u.LAST_NAME].filter(Boolean);
        row.name = nameParts.join(' ') || id;
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => b.sum - a.sum);
}

// --- Пользователи: id → запись ---
function usersById(users) {
  if (!users) return {};
  const map = {};
  for (const u of users) {
    if (u?.ID) map[String(u.ID)] = u;
  }
  return map;
}

// --- Состояние ---
let dataState = { ready: false, loading: false, error: null, dealsCount: 0, carryOverCount: 0, loadingProgress: null };
let dealsCache = [];
let carryOverCache = [];
let dictsCache = null;
let weeklyData = null; // { periods, carryOver }
let monthlyData = null;
let kpiCache = null;
let topMgrsCache = [];

async function reloadData() {
  dataState.loading = true;
  dataState.error = null;
  dataState.dealsCount = 0;
  dataState.carryOverCount = 0;
  try {
    // Загружаем сделки 2026
    dealsCache = await fetchAllDeals();
    dataState.dealsCount = dealsCache.length;
    
    // Загружаем сделки переходящего остатка
    carryOverCache = await fetchCarryOver();
    dataState.carryOverCount = carryOverCache.length;
    
    dictsCache = await fetchDicts();
    
    // Агрегация по неделям и месяцам
    weeklyData = aggregateWithCarryOver(dealsCache, carryOverCache, 'week');
    monthlyData = aggregateWithCarryOver(dealsCache, carryOverCache, 'month');
    
    kpiCache = calcKpi(weeklyData.periods);
    const usersMap = usersById(dictsCache?.users);
    topMgrsCache = topByPaid(dealsCache, usersMap);

    // Кешируем
    await fs.writeFile(
      path.join(DATA_DIR, 'cache.json'),
      JSON.stringify({
        deals: dealsCache,
        carryOver: carryOverCache,
        dicts: dictsCache,
        weekly: weeklyData,
        monthly: monthlyData,
        kpi: kpiCache,
        topMgrs: topMgrsCache,
      }),
      'utf-8'
    );
    dataState.ready = true;
    dataState.dealsCount = dealsCache.length;
    dataState.carryOverCount = carryOverCache.length;
    console.log('✓ Data reloaded and cached');
  } catch (e) {
    dataState.error = e.message;
    console.error('✗ reloadData failed:', e.message);
  } finally {
    dataState.loading = false;
  }
}

async function loadCache() {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, 'cache.json'), 'utf-8');
    const c = JSON.parse(raw);
    dealsCache = c.deals || [];
    carryOverCache = c.carryOver || [];
    dictsCache = c.dicts || null;
    weeklyData = c.weekly || { periods: [], carryOver: { cnt: 0, sum: 0 } };
    monthlyData = c.monthly || { periods: [], carryOver: { cnt: 0, sum: 0 } };
    kpiCache = c.kpi || calcKpi([]);
    topMgrsCache = c.topMgrs || [];

    const hasPayField = dealsCache.some(d => d && d.UF_DATE_PAY_1C !== undefined);
    if (!hasPayField && dealsCache.length > 0) {
      console.log('Cache is outdated. Forcing reload...');
      dealsCache = [];
      carryOverCache = [];
      weeklyData = { periods: [], carryOver: { cnt: 0, sum: 0 } };
      monthlyData = { periods: [], carryOver: { cnt: 0, sum: 0 } };
      kpiCache = calcKpi([]);
      topMgrsCache = [];
      dataState.ready = false;
    } else {
      dataState.ready = true;
      dataState.dealsCount = dealsCache.length;
      dataState.carryOverCount = carryOverCache.length;

      // Если weekly/monthly пустые — пересчитать из сделок
      if ((!weeklyData.periods || weeklyData.periods.length === 0) && dealsCache.length > 0) {
        console.log('Recalculating weekly/monthly from cache...');
        const validDeals = dealsCache.filter(d => d && !isCopy(d) && !isTechPaid(d) && parseFloat(d.OPPORTUNITY || 0) > 0);
        const weekResult = aggregateWithCarryOver(validDeals, carryOverCache, 'week');
        weeklyData = weekResult;
        const monthResult = aggregateWithCarryOver(validDeals, carryOverCache, 'month');
        monthlyData = monthResult;
        kpiCache = calcKpi(monthResult?.periods || []);
        topMgrsCache = calcTopManagers(validDeals, monthResult?.periods || []);
        console.log(`✓ Recalculated: ${weeklyData.periods?.length || 0} weeks, ${monthlyData.periods?.length || 0} months`);
      }

      console.log(`✓ Cache loaded: ${dealsCache.length} deals, ${carryOverCache.length} carry-over`);
    }
  } catch {
    console.log('No cache found on disk.');
  }
}

// --- Express ---
const app = express();
app.use(express.json());

// Статус
app.get('/api/status', (req, res) => res.json(dataState));

// API: данные за период (week|month)
app.get('/api/overview', (req, res) => {
  const period = req.query.period === 'month' ? 'month' : 'week';
  const data = period === 'month' ? monthlyData : weeklyData;
  const periodKpi = calcKpi(data?.periods || []);
  res.json({
    periods: data?.periods || [],
    carryOver: data?.carryOver || { cnt: 0, sum: 0 },
    kpi: periodKpi,
    topManagers: topMgrsCache || [],
    dealsCount: dataState.dealsCount,
    carryOverCount: dataState.carryOverCount,
  });
});

// API: переходящий остаток
app.get('/api/carryover', (req, res) => {
  res.json({
    cnt: carryOverCache?.length || 0,
    sum: carryOverCache?.reduce((s, d) => s + parseFloat(d.OPPORTUNITY || 0), 0) || 0,
    deals: carryOverCache || [],
  });
});

// API: KPI
app.get('/api/kpi', (req, res) => res.json(kpiCache));

// API: топ менеджеров
app.get('/api/top-managers', (req, res) => res.json(topMgrsCache || []));

// API: обновить данные
app.post('/api/refresh', (req, res) => {
  if (dataState.loading) return res.json({ ok: false, message: 'Already loading' });
  res.json({ ok: true, message: 'Data reload started' });
  reloadData();
});

// API: месячный отчёт по новым правилам (вкладка Апрель)
app.get('/api/month-report', (req, res) => {
  const year = parseInt(req.query.year) || 2026;
  const month = parseInt(req.query.month) || 4;
  if (!dataState.ready) {
    return res.json({ error: 'Data not loaded', ready: false });
  }
  const result = calcMonthNew(year, month, dealsCache, carryOverCache);
  res.json(result);
});

// API: сделки
app.get('/api/deals', (req, res) => res.json(dealsCache || []));

// API: справочники
app.get('/api/dicts', (req, res) => res.json(dictsCache || {}));

// API: отчёт по источнику
app.get('/api/source-report', (req, res) => {
  if (!dataState.ready) {
    return res.json({ error: 'Data not loaded', ready: false });
  }
  const sourceId = req.query.source || '79641902877';
  const yearFrom = parseInt(req.query.yearFrom) || YEAR;
  const yearTo = parseInt(req.query.yearTo) || YEAR;
  const allDeals = dealsCache || [];

  // Фильтр по источнику и годам
  const sourceDeals = allDeals.filter(d => {
    if (!d || d.SOURCE_ID !== sourceId) return false;
    if (!d.DATE_CREATE) return false;
    const y = new Date(d.DATE_CREATE).getFullYear();
    return y >= yearFrom && y <= yearTo;
  });

  // Разбивка по воронкам
  const preSale = sourceDeals.filter(d => String(d.CATEGORY_ID) === '8');
  const sale = sourceDeals.filter(d => String(d.CATEGORY_ID) === '0');
  const kom = sourceDeals.filter(d => String(d.CATEGORY_ID) === '19');

  // ⚠️ C8:WON (Передано в ОП) — копии, полностью исключены

  // Pre Sale анализ (игнорируем C8:WON как копии)
  const preLost = preSale.filter(d => d.STAGE_ID === 'C8:LOSE');
  const preOnQualification = preSale.filter(d => d.STAGE_ID !== 'C8:LOSE' && d.STAGE_ID !== 'C8:WON');
  // Конверсия: кто не проиграл = перешли в Сейл
  const preTransitioned = preSale.length - preLost.length;

  // Sale анализ
  const saleWon = sale.filter(d => d.CLOSED === 'Y' && d.STAGE_SEMANTIC_ID === 'S');
  const salePaid = saleWon.filter(d => d.UF_DATE_PAY_1C && parseFloat(d.OPPORTUNITY || 0) > 0);
  const saleLost = sale.filter(d => d.STAGE_SEMANTIC_ID === 'F');
  const saleInWork = sale.filter(d => d.STAGE_SEMANTIC_ID === 'P');

  // Суммы по SQL (DETAILS) и Счёт отправлен (PROPOSAL)
  const sqlDeals = sale.filter(d => d.STAGE_ID === 'DETAILS' || d.STAGE_ID === 'C0:DETAILS');
  const sqlSum = sqlDeals.reduce((s, d) => s + parseFloat(d.OPPORTUNITY || 0), 0);
  const sqlCnt = sqlDeals.length;
  const proposalDeals = sale.filter(d => d.STAGE_ID === 'PROPOSAL' || d.STAGE_ID === 'C0:PROPOSAL');
  const proposalSum = proposalDeals.reduce((s, d) => s + parseFloat(d.OPPORTUNITY || 0), 0);
  const proposalCnt = proposalDeals.length;

  // Конверсионные цепочки
  const preConv = preSale.length ? (preTransitioned / preSale.length * 100) : 0;
  const saleConv = sale.length ? (salePaid.length / sale.length * 100) : 0;
  const totalConv = sourceDeals.length ? (salePaid.length / sourceDeals.length * 100) : 0;

  // Ежемесячная динамика (c учётом года)
  const monthMap = new Map();
  for (let y = yearFrom; y <= yearTo; y++) {
    for (let m = 1; m <= 12; m++) {
      const key = y * 100 + m;
      monthMap.set(key, { year: y, month: m, key, created: 0, preTransitioned: 0, preLost: 0,
        saleCreated: 0, salePaid: 0, saleSum: 0, saleLost: 0 });
    }
  }
  for (const d of preSale) {
    if (!d.DATE_CREATE) continue;
    const dt = new Date(d.DATE_CREATE);
    const key = dt.getFullYear() * 100 + (dt.getMonth() + 1);
    const row = monthMap.get(key); if (!row) continue;
    row.created++;
    if (d.STAGE_ID === 'C8:LOSE') row.preLost++;
    else row.preTransitioned++;
  }
  for (const d of sale) {
    if (!d.DATE_CREATE) continue;
    const dt = new Date(d.DATE_CREATE);
    const key = dt.getFullYear() * 100 + (dt.getMonth() + 1);
    const row = monthMap.get(key); if (!row) continue;
    row.saleCreated++;
    if (d.STAGE_SEMANTIC_ID === 'F') row.saleLost++;
  }
  for (const d of salePaid) {
    if (!d.UF_DATE_PAY_1C) continue;
    const dt = new Date(d.UF_DATE_PAY_1C.slice(0, 10));
    const key = dt.getFullYear() * 100 + (dt.getMonth() + 1);
    const row = monthMap.get(key); if (!row) continue;
    row.salePaid++;
    row.saleSum += parseFloat(d.OPPORTUNITY || 0);
  }

  const monthly = Array.from(monthMap.values()).filter(r => r.created > 0 || r.saleCreated > 0);

  // Время от создания до оплаты
  const leadTimes = salePaid.map(d => {
    const created = new Date(d.DATE_CREATE.slice(0, 10));
    const paid = new Date(d.UF_DATE_PAY_1C.slice(0, 10));
    const days = Math.max(0, Math.round((paid - created) / 86400000));
    return { id: d.ID, title: (d.TITLE || '').slice(0, 60), opportunity: parseFloat(d.OPPORTUNITY || 0), days };
  }).sort((a, b) => a.days - b.days);

  // Stage breakdown for Sale funnel
  const saleStageMap = {};
  for (const d of sale) {
    const sid = d.STAGE_ID;
    if (!saleStageMap[sid]) saleStageMap[sid] = { stageId: sid, cnt: 0, paid: 0, sum: 0 };
    saleStageMap[sid].cnt++;
    if (d.UF_DATE_PAY_1C && parseFloat(d.OPPORTUNITY || 0) > 0) {
      saleStageMap[sid].paid++;
      saleStageMap[sid].sum += parseFloat(d.OPPORTUNITY || 0);
    }
  }
  const saleStages = Object.values(saleStageMap);

  // Справочник имён
  const sourceName = (dictsCache?.sources || []).find(s => s.STATUS_ID === sourceId)?.NAME || sourceId;
  const stageNames = {};
  for (const s of (dictsCache?.stages || [])) stageNames[s.STATUS_ID] = s.NAME;

  // Менеджеры по Сейл
  const mgrMap = {};
  for (const d of sale) {
    const mgr = d.PRODUCT_ID || d.ASSIGNED_BY_ID || 'unknown';
    if (!mgrMap[mgr]) mgrMap[mgr] = { id: mgr, cnt: 0, paid: 0, paidSum: 0, lost: 0 };
    mgrMap[mgr].cnt++;
    if (d.STAGE_SEMANTIC_ID === 'F') mgrMap[mgr].lost++;
    if (d.UF_DATE_PAY_1C && parseFloat(d.OPPORTUNITY || 0) > 0 && d.CLOSED === 'Y' && d.STAGE_SEMANTIC_ID === 'S') {
      mgrMap[mgr].paid++;
      mgrMap[mgr].paidSum += parseFloat(d.OPPORTUNITY || 0);
    }
  }
  // Имена менеджеров из справочника пользователей
  const userNames = {};
  if (dictsCache?.users) {
    for (const u of dictsCache.users) {
      if (u.ID) userNames[u.ID] = u.NAME + ' ' + (u.LAST_NAME || '');
    }
  }
  const managers = Object.values(mgrMap)
    .map(m => ({ ...m, name: userNames[m.id] || m.id }))
    .sort((a, b) => b.cnt - a.cnt);

  // Список всех источников с количеством сделок (для селектора)
  const sourceStats = {};
  const allSourceDeals = allDeals.filter(d => d && d.DATE_CREATE && new Date(d.DATE_CREATE).getFullYear() >= yearFrom && new Date(d.DATE_CREATE).getFullYear() <= yearTo);
  for (const d of allSourceDeals) {
    const sid = d.SOURCE_ID || 'OTHER';
    if (!sourceStats[sid]) sourceStats[sid] = { id: sid, name: '', total: 0, preSale: 0, sale: 0 };
    sourceStats[sid].total++;
    if (String(d.CATEGORY_ID) === '8') sourceStats[sid].preSale++;
    if (String(d.CATEGORY_ID) === '0') sourceStats[sid].sale++;
  }
  for (const sid of Object.keys(sourceStats)) {
    const s = (dictsCache?.sources || []).find(src => src.STATUS_ID === sid);
    sourceStats[sid].name = s ? s.NAME : sid;
  }
  const sourceList = Object.values(sourceStats)
    .filter(s => s.total >= 10) // только источники с 10+ сделок
    .sort((a, b) => b.total - a.total);

  res.json({
    sourceId,
    sourceName,
    yearFrom,
    yearTo,
    totals: {
      total: sourceDeals.length,
      preSale: preSale.length,
      sale: sale.length,
      kom: kom.length,
    },
    preSale: {
      total: preSale.length,
      lost: preLost.length,
      onQualification: preOnQualification.length,
      transitioned: preTransitioned,
      conversionToSale: preConv,
    },
    sale: {
      total: sale.length,
      paid: salePaid.length,
      paidSum: salePaid.reduce((s, d) => s + parseFloat(d.OPPORTUNITY || 0), 0),
      lost: saleLost.length,
      inWork: saleInWork.length,
      conversionSold: saleConv,
      stages: saleStages,
      sql: { cnt: sqlCnt, sum: sqlSum },
      proposal: { cnt: proposalCnt, sum: proposalSum },
    },
    pipeline: {
      conversionPreToSale: preConv,
      conversionSaleToPaid: saleConv,
      conversionTotal: totalConv,
      avgLeadTime: leadTimes.length ? Math.round(leadTimes.reduce((s, d) => s + d.days, 0) / leadTimes.length) : 0,
      minLeadTime: leadTimes.length ? leadTimes[0].days : 0,
      maxLeadTime: leadTimes.length ? leadTimes[leadTimes.length - 1].days : 0,
    },
    monthly,
    leadTimes,
    stageNames,
    managers,
    sourceList,
  });
});

// API: прогноз на месяц
app.get('/api/forecast', (req, res) => {
  if (!dataState.ready) return res.json({ error: 'Data not loaded' });
  const deals = dealsCache || [];
  const sale = deals.filter(d => d && String(d.CATEGORY_ID) === '0');
  const today = new Date();
  const month = parseInt(req.query.month) || today.getMonth() + 1;
  const year = parseInt(req.query.year) || today.getFullYear();
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);
  const daysInMonth = monthEnd.getDate();
  const daysPassed = Math.min(today.getDate(), daysInMonth);
  const daysLeft = daysInMonth - daysPassed + 1;

  // 0. Факт: уже оплачено в этом месяце
  const paid = sale.filter(d => {
    if (!d.UF_DATE_PAY_1C) return false;
    if (!(d.CLOSED === 'Y' && d.STAGE_SEMANTIC_ID === 'S')) return false;
    if (parseFloat(d.OPPORTUNITY || 0) <= 0) return false;
    try {
      const pd = new Date(d.UF_DATE_PAY_1C.slice(0, 10));
      return pd >= monthStart && pd <= today;
    } catch(e) { return false; }
  });
  const factCnt = paid.length;
  const factSum = paid.reduce((s, d) => s + parseFloat(d.OPPORTUNITY || 0), 0);

  // Текущая воронка (в работе) — weighted pipeline
  const inWork = sale.filter(d => {
    if (d.STAGE_ID === 'WON') return false;
    if (d.STAGE_SEMANTIC_ID === 'F') return false;
    if (d.UF_DATE_PAY_1C) return false;
    if (d.UF_CRM_1753341391806) return false;
    return true;
  });
  const pipelineWeights = {'DETAILS': 0.16, 'PROPOSAL': 0.88, '2': 0.95, '6': 0.90};
  let pipelineForecast = 0;
  const pipelineDetail = {};
  for (const d of inWork) {
    const w = pipelineWeights[d.STAGE_ID] || 0;
    pipelineForecast += parseFloat(d.OPPORTUNITY || 0) * w;
    const key = d.STAGE_ID;
    if (!pipelineDetail[key]) pipelineDetail[key] = { stageId: key, cnt: 0, sum: 0, weight: w, forecast: 0 };
    pipelineDetail[key].cnt++;
    pipelineDetail[key].sum += parseFloat(d.OPPORTUNITY || 0);
    pipelineDetail[key].forecast += parseFloat(d.OPPORTUNITY || 0) * w;
  }

  // Прогноз по новым лидам
  const created = sale.filter(d => {
    if (!d.DATE_CREATE) return false;
    try {
      const cd = new Date(d.DATE_CREATE.slice(0, 10));
      return cd >= monthStart && cd <= today;
    } catch(e) { return false; }
  });
  const avgPerDay = daysPassed > 0 ? created.length / daysPassed : 0;
  const newForecastCnt = Math.round(avgPerDay * daysLeft);
  const avgSum = created.length > 0 ? created.reduce((s, d) => s + parseFloat(d.OPPORTUNITY || 0), 0) / created.length : 0;
  // 44% сделок укладываются в 7 дней
  const newForecastSum = newForecastCnt * avgSum * 0.44 * 0.88; // через счёт

  // Менеджеры — прогресс
  const mgrMap = {};
  const stageNames = {'NEW':'NEW','UC_VKPN0N':'Приоритет','UC_1YW3V2':'Аларм','UC_STZB49':'Взят','UC_838R2R':'Консульт.','UC_4RJOR4':'MQL','DETAILS':'SQL','PROPOSAL':'Счёт','6':'Частич.','2':'Постоплата','UC_W6SCHG':'След год','UC_670ME2':'Возвращен'};
  const moneyStages = ['PROPOSAL', '6', '2']; // стадии с деньгами (счёт/частичная/постоплата)
  for (const d of inWork) {
    const mid = String(d.ASSIGNED_BY_ID || '0');
    if (!mgrMap[mid]) mgrMap[mid] = { id: mid, name: mid, inWork: 0, inWorkSum: 0, withMoney: 0, withMoneySum: 0 };
    mgrMap[mid].inWork++;
    mgrMap[mid].inWorkSum += parseFloat(d.OPPORTUNITY || 0);
    if (moneyStages.includes(d.STAGE_ID)) {
      mgrMap[mid].withMoney++;
      mgrMap[mid].withMoneySum += parseFloat(d.OPPORTUNITY || 0);
    }
  }
  // Добавляем оплаченные
  for (const d of paid) {
    const mid = String(d.ASSIGNED_BY_ID || '0');
    if (!mgrMap[mid]) mgrMap[mid] = { id: mid, name: mid, inWork: 0, inWorkSum: 0, withMoney: 0, withMoneySum: 0 };
    if (!mgrMap[mid].paid) mgrMap[mid].paid = 0;
    if (!mgrMap[mid].paidSum) mgrMap[mid].paidSum = 0;
    mgrMap[mid].paid = (mgrMap[mid].paid || 0) + 1;
    mgrMap[mid].paidSum = (mgrMap[mid].paidSum || 0) + parseFloat(d.OPPORTUNITY || 0);
  }
  const usersMap = usersById(dictsCache?.users);
  for (const [id, row] of Object.entries(mgrMap)) {
    const u = usersMap[id];
    if (u) row.name = [u.NAME, u.LAST_NAME].filter(Boolean).join(' ') || id;
  }
  const managers = Object.values(mgrMap).sort((a, b) => (b.paidSum || 0) - (a.paidSum || 0));

  // Разделяем на май/июнь по датам из названия
  function goesToJune(title) {
    if (!title) return false;
    const m = title.match(/(\d{2})[.\s-](\d{2})[.\s-]/g);
    if (!m) return false;
    for (const match of m) {
      const parts = match.match(/(\d{2})/g);
      if (parts && parts.length >= 2 && parseInt(parts[1]) >= 6) return true;
    }
    return false;
  }
  let forecastMay = 0, forecastJun = 0;
  const stageMay = {}, stageJun = {};
  for (const d of inWork) {
    const w = pipelineWeights[d.STAGE_ID] || 0;
    const amt = parseFloat(d.OPPORTUNITY || 0) * w;
    const isJune = goesToJune(d.TITLE) || (d.UF_DATE_PAY_1C && new Date(d.UF_DATE_PAY_1C.slice(0, 10)) >= new Date(year, month, 1));
    if (isJune) { forecastJun += amt; if (!stageJun[d.STAGE_ID]) stageJun[d.STAGE_ID] = {stageId: d.STAGE_ID, cnt: 0, sum: 0, forecast: 0, weight: w}; stageJun[d.STAGE_ID].cnt++; stageJun[d.STAGE_ID].sum += parseFloat(d.OPPORTUNITY||0); stageJun[d.STAGE_ID].forecast += amt; }
    else { forecastMay += amt; if (!stageMay[d.STAGE_ID]) stageMay[d.STAGE_ID] = {stageId: d.STAGE_ID, cnt: 0, sum: 0, forecast: 0, weight: w}; stageMay[d.STAGE_ID].cnt++; stageMay[d.STAGE_ID].sum += parseFloat(d.OPPORTUNITY||0); stageMay[d.STAGE_ID].forecast += amt; }
  }

  // Конверсия SQL→Оплата (из истории WON-сделок)
  const allWonDeals = sale.filter(d => d.STAGE_ID === 'WON' && d.STAGE_SEMANTIC_ID === 'S' && parseFloat(d.OPPORTUNITY||0) > 0 && d.UF_DATE_PAY_1C);
  const allLostDeals = sale.filter(d => d.STAGE_SEMANTIC_ID === 'F' && d.CLOSED === 'Y');
  const convSqlOplata = allWonDeals.length > 0 
    ? allWonDeals.length / (allWonDeals.length + allLostDeals.length) 
    : 0;

  // Прогноз по SQL (DETAILS — стадия «лид для продажи»)
  const sqlMay = stageMay['DETAILS'] || { sum: 0, cnt: 0 };
  const forecastSQL = sqlMay.sum * convSqlOplata;

  // Новые лиды — сколько уложатся в 5 дней (осталось до конца мая)
  const fast5 = allWonDeals.filter(d => { try { return (new Date(d.UF_DATE_PAY_1C.slice(0,10)) - new Date(d.DATE_CREATE.slice(0,10))) / 86400000 <= 5; } catch(e) { return false; } });
  const pctFast5 = allWonDeals.length > 0 ? fast5.length / allWonDeals.length : 0;
  const newForecastAdjusted = newForecastCnt * avgSum * pctFast5;

  res.json({
    year, month,
    fact: { cnt: factCnt, sum: Math.round(factSum) },
    pipeline: {
      may: Math.round(forecastMay),
      june: Math.round(forecastJun),
      total: Math.round(forecastMay + forecastSQL),
      stages: Object.values(pipelineDetail).sort((a,b) => (b.forecast||0)-(a.forecast||0)),
      stagesMay: Object.values(stageMay).sort((a,b) => (b.forecast||0)-(a.forecast||0)),
      stagesJune: Object.values(stageJun).sort((a,b) => (b.forecast||0)-(a.forecast||0)),
    },
    sql: { 
      sum: Math.round(sqlMay.sum), 
      forecast: Math.round(forecastSQL), 
      convPct: Math.round(convSqlOplata * 100) 
    },
    newLeads: { cnt: newForecastCnt, sum: Math.round(newForecastAdjusted), avgPerDay: Math.round(avgPerDay * 10) / 10, pctFast5: Math.round(pctFast5 * 100) },
    total: Math.round(factSum + forecastMay + forecastSQL + newForecastAdjusted),
    managers,
    daysLeft,
    daysPassed,
    juneForecast: Math.round(forecastJun),
  });
});

// ===== API: Рейтинг продуктов (из Excel-файла Ольги — эталон) =====
app.get('/api/product-ranking', async (req, res) => {
  try {
    const xlsxPath = '/root/.openclaw/media/inbound/выгрузка_май_20266_оплаты_для_ИИ---f37f06ca-a14d-45cb-a070-afc94a1770df.xlsx';
    
    // Dynamic import of xlsx
    const wb = xlsx.readFile(xlsxPath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(ws, { header: 1 });
    
    if (data.length < 2) {
      return res.json({ error: 'Excel пуст' });
    }
    
    // Map columns: 0=ID, 1=Title, 5=Sum, 17=Format, 18=Direction, 24=KOM
    const rows = data.slice(1); // skip header
    
    function cleanTitle(t) {
      if (!t) return 'Unknown';
      let t2 = String(t);
      t2 = t2.replace(/НЕ удалять пока! /gi, '');
      t2 = t2.replace(/\d{2}\.\d{2}\.\d{4}/g, '');
      t2 = t2.replace(/\d{4}-\d{2}-\d{2}/g, '');
      t2 = t2.replace(/с \d{2}\.\d{2}\.\d{4}/gi, '');
      t2 = t2.replace(/по \d{2}\.\d{2}\.\d{4}/gi, '');
      t2 = t2.replace(/в г\.\s*\S+[\S]*/g, '');
      t2 = t2.replace(/\(Москва\)/g, '');
      t2 = t2.replace(/\(Санкт-Петербург\)/g, '');
      t2 = t2.replace(/\(СДО\)/g, '');
      t2 = t2.replace(/\(онлайн\)/gi, '');
      t2 = t2.replace(/Договор\s*№\s*\d+(\s+от\s+\d{2}\.\d{2}\.\d{4})?/g, '');
      t2 = t2.replace(/от\s+/g, '');
      t2 = t2.replace(/\d{2}\.\d{2}-/g, '');
      t2 = t2.replace(/-\s*\d{2}\.\d{2}$/g, '');
      t2 = t2.replace(/^\d{2}\.\d{2}\s*/g, '');
      t2 = t2.replace(/\s+\d{2}$/g, '');
      t2 = t2.replace(/\s+\d{2}\s/g, ' ');
      t2 = t2.replace(/\s+/g, ' ').trim();
      return t2.length > 3 ? t2 : String(t).trim();
    }
    
    const all = [];
    for (const row of rows) {
      if (!row[0]) continue;
      all.push({
        id: String(row[0]),
        title: String(row[1] || ''),
        summa: parseFloat(row[5]) || 0,
        format: String(row[17] || '').trim(),
        naprav: String(row[18] || '').trim(),
        kom: String(row[24] || '').trim()
      });
    }
    
    // Разделяем
    const main = [], ilp = [], corp = [];
    for (const d of all) {
      if (d.kom === 'Да' || d.naprav === 'Корпоративное обучение') {
        corp.push(d);
      } else if (d.title.toUpperCase().startsWith('ILP') || d.title.includes(' ILP ')) {
        ilp.push(d);
      } else {
        main.push(d);
      }
    }
    
    function group(arr) {
      const map = {};
      for (const d of arr) {
        const name = cleanTitle(d.title);
        if (!map[name]) map[name] = { cnt: 0, rev: 0, formats: {} };
        map[name].cnt++;
        map[name].rev += d.summa;
        const f = d.format || '—';
        map[name].formats[f] = (map[name].formats[f] || 0) + 1;
      }
      return Object.entries(map).map(([k,v]) => ({ name: k, cnt: v.cnt, rev: Math.round(v.rev), formats: v.formats }));
    }
    
    const mainRanking = group(main);
    const byRev = [...mainRanking].sort((a,b) => b.rev - a.rev || b.cnt - a.cnt).slice(0,20);
    const byCnt = [...mainRanking].sort((a,b) => b.cnt - a.cnt || b.rev - a.rev).slice(0,20);
    
    res.json({
      total_all: all.length,
      main: { count: main.length, revenue: Math.round(main.reduce((s,d) => s + d.summa, 0)), byRev, byCnt },
      ilp: { count: ilp.length, revenue: Math.round(ilp.reduce((s,d) => s + d.summa, 0)), items: group(ilp) },
      corp: { count: corp.length, revenue: Math.round(corp.reduce((s,d) => s + d.summa, 0)), items: group(corp) }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== API: Рейтинг продуктов с начала года (Live B24) =====
app.get('/api/product-ranking-year', async (req, res) => {
  const WEBHOOK = 'https://24.uprav.ru/rest/516/k1cdomfp4vd1kiql/';
  const fmtNames = { '19042467': 'Очный', '19042468': 'Онлайн', '19042469': 'СДО', '19042498': 'КОМ' };
  
  async function b24(method, params) {
    const body = Object.entries(params).map(([k,v]) => {
      if (Array.isArray(v)) return v.map(x => encodeURIComponent(k) + '=' + encodeURIComponent(x)).join('&');
      return encodeURIComponent(k) + '=' + encodeURIComponent(v);
    }).join('&');
    const resp = await fetch(WEBHOOK + method, { method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body });
    return resp.json();
  }
  
  async function b24All(method, params) {
    const all = []; let start = 0;
    while (true) {
      const r = await b24(method, { ...params, limit: '50', start: String(start) });
      const items = r.result || [];
      if (!items.length) break;
      all.push(...items);
      if (r.next === undefined || r.next === null) break;
      start = r.next;
    }
    return all;
  }
  
  try {
    // Запрашиваем все оплаченные сделки Sale с начала 2026 года
    const deals = await b24All('crm.deal.list', {
      'filter[CATEGORY_ID]': '0',
      'filter[>OPPORTUNITY]': '0',
      'filter[>=UF_DATE_PAY_1C]': '2026-01-01',
      'filter[<=UF_DATE_PAY_1C]': '2026-12-31',
      'select[]': ['ID', 'TITLE', 'OPPORTUNITY', 'UF_DATE_PAY_1C', 'UF_FORMAT', 'UF_CRM_1744273716729', 'UF_CRM_1697096074', 'CATEGORY_ID', 'CLOSED', 'STAGE_SEMANTIC_ID', 'DATE_CREATE']
    });
    
    // Фильтр: только WON + с суммой
    const paid = deals.filter(d => {
      return d && d.CLOSED === 'Y' && d.STAGE_SEMANTIC_ID === 'S' && parseFloat(d.OPPORTUNITY || 0) > 0;
    });
    
    function cleanTitle(t) {
      if (!t) return 'Unknown';
      let t2 = String(t);
      t2 = t2.replace(/НЕ удалять пока! /gi, '');
      t2 = t2.replace(/\d{2}\.\d{2}\.\d{4}/g, '');
      t2 = t2.replace(/\d{4}-\d{2}-\d{2}/g, '');
      t2 = t2.replace(/с \d{2}\.\d{2}\.\d{4}/gi, '');
      t2 = t2.replace(/по \d{2}\.\d{2}\.\d{4}/gi, '');
      t2 = t2.replace(/в г\.\s*\S+[\S]*/g, '');
      t2 = t2.replace(/\(Москва\)/g, '');
      t2 = t2.replace(/\(Санкт-Петербург\)/g, '');
      t2 = t2.replace(/\(СДО\)/g, '');
      t2 = t2.replace(/\(онлайн\)/gi, '');
      t2 = t2.replace(/Договор\s*№\s*\d+(\s+от\s+\d{2}\.\d{2}\.\d{4})?/g, '');
      t2 = t2.replace(/от\s+/g, '');
      t2 = t2.replace(/\d{2}\.\d{2}-/g, '');
      t2 = t2.replace(/-\s*\d{2}\.\d{2}$/g, '');
      t2 = t2.replace(/^\d{2}\.\d{2}\s*/g, '');
      t2 = t2.replace(/\s+\d{2}$/g, '');
      t2 = t2.replace(/\s+\d{2}\s/g, ' ');
      t2 = t2.replace(/\s+/g, ' ').trim();
      return t2.length > 3 ? t2 : String(t).trim();
    }
    
    // Собираем с полями
    const allItems = [];
    for (const d of paid) {
      const productClean = d.UF_CRM_1697096074 || '';
      const productName = productClean || cleanTitle(d.TITLE || '');
      const fmtId = String(d.UF_FORMAT || '');
      const fmtName = fmtNames[fmtId] || 'Другой';
      const naprav = String(d.UF_CRM_1744273716729 || '').trim();
      const isKom = naprav === 'Корпоративное обучение' || fmtId === '19042498';
      
      allItems.push({
        id: d.ID,
        title: d.TITLE || '',
        productName,
        summa: parseFloat(d.OPPORTUNITY || 0),
        format: fmtName,
        naprav: naprav || '—',
        kom: isKom,
        payDate: (d.UF_DATE_PAY_1C || '').slice(0, 10),
      });
    }
    
    // Разделяем
    const main = [], ilp = [], corp = [];
    for (const d of allItems) {
      if (d.kom) {
        corp.push(d);
      } else if (d.productName.toUpperCase().startsWith('ILP') || d.productName.includes(' ILP ')) {
        ilp.push(d);
      } else {
        main.push(d);
      }
    }
    
    function group(arr) {
      const map = {};
      for (const d of arr) {
        const name = d.productName;
        if (!map[name]) map[name] = { cnt: 0, rev: 0, formats: {} };
        map[name].cnt++;
        map[name].rev += d.summa;
        const f = d.format || '—';
        map[name].formats[f] = (map[name].formats[f] || 0) + 1;
      }
      return Object.entries(map).map(([k,v]) => ({ name: k, cnt: v.cnt, rev: Math.round(v.rev), formats: v.formats }));
    }
    
    const mainRanking = group(main);
    const byRev = [...mainRanking].sort((a,b) => b.rev - a.rev || b.cnt - a.cnt).slice(0,20);
    const byCnt = [...mainRanking].sort((a,b) => b.cnt - a.cnt || b.rev - a.rev).slice(0,20);
    
    res.json({
      yearFrom: 2026,
      yearTo: 2026,
      total_all: allItems.length,
      main: { count: main.length, revenue: Math.round(main.reduce((s,d) => s + d.summa, 0)), byRev, byCnt },
      ilp: { count: ilp.length, revenue: Math.round(ilp.reduce((s,d) => s + d.summa, 0)), items: group(ilp) },
      corp: { count: corp.length, revenue: Math.round(corp.reduce((s,d) => s + d.summa, 0)), items: group(corp) },
      dateRange: paid.length ? { from: paid.reduce((a,d) => (!a||d.UF_DATE_PAY_1C<a) ? d.UF_DATE_PAY_1C.slice(0,10) : a, null), to: paid.reduce((a,d) => d.UF_DATE_PAY_1C>a ? d.UF_DATE_PAY_1C.slice(0,10) : a, '') } : null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== Live API (прямые запросы в B24, без кеша) =====
app.get('/api/charts-data', async (req, res) => {
  const WEBHOOK = 'https://24.uprav.ru/rest/516/k1cdomfp4vd1kiql/';
  async function b24(method, params) {
    const body = Object.entries(params).map(([k,v]) => {
      if (Array.isArray(v)) return v.map(x => encodeURIComponent(k) + '=' + encodeURIComponent(x)).join('&');
      return encodeURIComponent(k) + '=' + encodeURIComponent(v);
    }).join('&');
    const resp = await fetch(WEBHOOK + method, { method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body });
    return resp.json();
  }
  async function b24All(method, params) {
    const all = []; let start = 0;
    while (true) {
      const r = await b24(method, { ...params, limit: '50', start: String(start) });
      const items = r.result || [];
      if (!items.length) break;
      all.push(...items);
      if (r.next === undefined || r.next === null || all.length >= 500) break;
      start = r.next;
    }
    return all;
  }
  try {
    const deals = await b24All('crm.deal.list', {
      'filter[CATEGORY_ID]': '0', 'filter[>OPPORTUNITY]': '0',
      'filter[>=UF_DATE_PAY_1C]': '2026-05-01', 'filter[<UF_DATE_PAY_1C]': '2026-06-01',
      'select[]': ['ID', 'TITLE', 'OPPORTUNITY', 'UF_DATE_PAY_1C', 'UF_FORMAT', 'UF_CRM_1744273716729', 'UF_CRM_1697096074', 'ASSIGNED_BY_ID', 'DATE_CREATE']
    });
    const daily = {}; const dirMap = {}; const fmtCnt = {}; const fmtSum = {}; const mgrMap = {};
    const fmtIds = { '19042467': 'Очный', '19042468': 'Онлайн', '19042469': 'СДО', '19042498': 'КОМ' };
    for (const d of deals) {
      const day = (d.UF_DATE_PAY_1C || '').slice(0, 10);
      if (day) { if (!daily[day]) daily[day] = { cnt: 0, sum: 0 }; daily[day].cnt++; daily[day].sum += parseFloat(d.OPPORTUNITY || 0); }
      const dir = d.UF_CRM_1744273716729 || 'Не указано';
      if (!dirMap[dir]) dirMap[dir] = { cnt: 0, sum: 0 }; dirMap[dir].cnt++; dirMap[dir].sum += parseFloat(d.OPPORTUNITY || 0);
      const f = fmtIds[String(d.UF_FORMAT || '')] || 'Другой';
      fmtCnt[f] = (fmtCnt[f] || 0) + 1; fmtSum[f] = (fmtSum[f] || 0) + parseFloat(d.OPPORTUNITY || 0);
      const mid = d.ASSIGNED_BY_ID || '0';
      if (!mgrMap[mid]) mgrMap[mid] = { name: mid, cnt: 0, sum: 0 }; mgrMap[mid].cnt++; mgrMap[mid].sum += parseFloat(d.OPPORTUNITY || 0);
    }
    res.json({
      total: deals.length,
      totalSum: Math.round(deals.reduce((s,d) => s + parseFloat(d.OPPORTUNITY||0), 0)),
      daily: Object.entries(daily).sort().map(([k,v]) => ({ date: k, cnt: v.cnt, sum: Math.round(v.sum) })),
      directions: Object.entries(dirMap).sort((a,b) => b[1].sum - a[1].sum).map(([k,v]) => ({ name: k, cnt: v.cnt, sum: Math.round(v.sum) })),
      formats: Object.keys(fmtCnt).map(k => ({ name: k, cnt: fmtCnt[k], sum: Math.round(fmtSum[k] || 0) })).sort((a,b) => b.sum - a.sum),
      managers: Object.values(mgrMap).sort((a,b) => b.sum - a.sum).slice(0,15).map(m => ({ name: m.name, cnt: m.cnt, sum: Math.round(m.sum) }))
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// Статика
app.use(express.static(path.join(__dirname, 'public')));

// Запасной маршрут
app.get(/(.*)/,  (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

export default app;

// --- Direct start (port mode) ---
const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  await loadCache();
  app.listen(PORT, '127.0.0.1', () => console.log(`Dashboard running at http://127.0.0.1:${PORT}`));
} else {
  // Фоновая загрузка кеша с диска (мгновенно)
  setTimeout(() => loadCache().catch(e => console.error('Cache load:', e.message)), 50);
}
