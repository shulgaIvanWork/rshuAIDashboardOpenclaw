/**
 * analyze-nps.js — Расчёт NPS-метрик из сделок PostSale.
 *
 * Читает cache/post-sale-deals.json, cache/dicts.json.
 * Возвращает агрегаты по месяцам.
 *
 * Категории NPS берутся из поля UF_CRM_5DF2528C641D4 (Статус участника обучения):
 *   Промоутер, Пассивный, Детрактор, Нет контактов.
 *
 * НЕ влияет на другие дашборды — работает с отдельным файлом post-sale-deals.json.
 */

import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  POSTSALE_SENT_STAGES,
  POSTSALE_FILLED_STAGES,
  LEARNER_STATUS,
  LEARNER_STATUS_FILLED,
  UF,
  FORMAT_MAP,
} from '@rshu/data-service/lib/deal-rules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, 'cache');

// ── Помощники ─────────────────────────────────────────────────────────────────

/** Убирает префикс воронки из STAGE_ID (например C9:LOSE → LOSE) */
function stripStagePrefix(stageId) {
  return String(stageId || '').replace(/^C\d+:/, '');
}

/** Проверяет, что сделка PostSale в статусе «анкета отправлена» */
export function isPostSaleSent(d) {
  return POSTSALE_SENT_STAGES.has(stripStagePrefix(d.STAGE_ID));
}

/** Проверяет, что сделка PostSale в статусе «NPS заполнен» (по стадии) */
export function isPostSaleFilled(d) {
  return POSTSALE_FILLED_STAGES.has(stripStagePrefix(d.STAGE_ID));
}

/** Извлекает оценку NPS из сделки (число 1-10 или null) */
export function getNpsScore(d) {
  const val = d[UF.NPS_SCORE];
  if (val === null || val === undefined || val === '' || val === false) return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

/**
 * Извлекает статус участника обучения (UF_CRM_5DF2528C641D4).
 * Возвращает: 'promoter' | 'passive' | 'detractor' | 'no_contact' | null
 */
export function getLearnerStatus(d) {
  const val = d[UF.LEARNER_STATUS];
  if (!val) return null;
  const s = String(val);
  if (s === LEARNER_STATUS.PROMOTER)   return 'promoter';
  if (s === LEARNER_STATUS.PASSIVE)    return 'passive';
  if (s === LEARNER_STATUS.DETRACTOR)  return 'detractor';
  if (s === LEARNER_STATUS.NO_CONTACT) return 'no_contact';
  return null;
}

// ── Агрегация ─────────────────────────────────────────────────────────────────

/**
 * Агрегирует NPS-данные по месяцам за указанный год.
 *
 * Категории (Промоутер/Пассивный/Детрактор) берутся из статуса участника обучения,
 * а не рассчитываются из оценки.
 *
 * Возвращает массив объектов:
 * {
 *   month: 1..12,
 *   year,
 *   sent, notFilled, filled, conversion,
 *   promoters, neutrals, detractors,
 *   detractorPct, nps, avgScore,
 * }
 */
export function aggregateByMonth(deals, year) {
  const months = {};

  for (const d of deals) {
    if (!isPostSaleSent(d)) continue;

    const dateStr = d.DATE_CREATE;
    if (!dateStr) continue;
    const dt = new Date(dateStr);
    const y = dt.getFullYear();
    const m = dt.getMonth() + 1;

    if (y !== year) continue;

    if (!months[m]) {
      months[m] = {
        month: m, year: y,
        sent: 0, filled: 0,
        promoters: 0, neutrals: 0, detractors: 0,
        scores: [],
      };
    }

    const mData = months[m];
    mData.sent++;

    // Заполнили — стадия «заполнено» И есть статус (не Нет контактов)
    if (isPostSaleFilled(d)) {
      const status = getLearnerStatus(d);
      if (status !== null && status !== 'no_contact') {
        mData.filled++;
        if (status === 'promoter')  mData.promoters++;
        if (status === 'passive')   mData.neutrals++;
        if (status === 'detractor') mData.detractors++;

        const score = getNpsScore(d);
        if (score !== null) {
          mData.scores.push(score);
        }
      }
    }
  }

  // Превращаем в массив, считаем производные метрики
  const result = [];
  for (let m = 1; m <= 12; m++) {
    const mData = months[m];
    if (!mData || mData.sent === 0) {
      result.push({
        month: m, year,
        sent: 0, notFilled: 0, filled: 0, conversion: 0,
        promoters: 0, neutrals: 0, detractors: 0,
        detractorPct: 0, nps: 0, avgScore: 0,
      });
      continue;
    }

    const sent = mData.sent;
    const filled = mData.filled;
    const notFilled = sent - filled;
    const conversion = sent > 0 ? Math.round((filled / sent) * 1000) / 10 : 0;

    const promoters = mData.promoters;
    const neutrals = mData.neutrals;
    const detractors = mData.detractors;
    const totalCat = promoters + neutrals + detractors;
    const detractorPct = totalCat > 0 ? Math.round((detractors / totalCat) * 1000) / 10 : 0;
    const nps = totalCat > 0
      ? Math.round(((promoters - detractors) / totalCat) * 1000) / 10
      : 0;

    const scores = mData.scores;
    const avgScore = scores.length > 0
      ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100
      : 0;

    result.push({
      month: m, year,
      sent, notFilled, filled, conversion,
      promoters, neutrals, detractors,
      detractorPct, nps, avgScore,
    });
  }

  return result;
}

/**
 * Добавляет приросты месяц-к-месяцу к массиву агрегатов.
 * Мутирует массив на месте.
 */
function addDeltas(months) {
  for (let i = 0; i < months.length; i++) {
    const cur = months[i];
    const prev = i > 0 ? months[i - 1] : null;

    cur.conversionGrowth = null;
    cur.filledGrowth = null;
    cur.filledGrowthAbs = null;
    cur.npsGrowth = null;
    cur.npsGrowthAbs = null;

    if (!prev || prev.sent === 0) continue;

    // Прирост конверсии
    if (prev.conversion > 0) {
      cur.conversionGrowth = Math.round(((cur.conversion - prev.conversion) / prev.conversion) * 1000) / 10;
    } else if (cur.conversion > 0) {
      cur.conversionGrowth = 100;
    }

    // Прирост кол-ва заполнивших
    if (prev.filled > 0) {
      cur.filledGrowth = Math.round(((cur.filled - prev.filled) / prev.filled) * 1000) / 10;
    }
    cur.filledGrowthAbs = cur.filled - prev.filled;

    // Прирост NPS
    if (prev.nps !== 0) {
      cur.npsGrowth = Math.round(((cur.nps - prev.nps) / Math.abs(prev.nps)) * 1000) / 10;
    }
    cur.npsGrowthAbs = Math.round((cur.nps - prev.nps) * 10) / 10;
  }
}

/**
 * Полная агрегация NPS: читает файл, считает по месяцам за указанный год,
 * добавляет приросты.
 */
export async function getNpsAgg(year) {
  let deals;
  try {
    const raw = await readFile(path.join(CACHE_DIR, 'post-sale-deals.json'), 'utf-8');
    deals = JSON.parse(raw);
  } catch (e) {
    return { months: [], year, total: { sent: 0, filled: 0, conversion: 0, nps: 0, avgScore: 0 } };
  }

  const months = aggregateByMonth(deals, year);
  addDeltas(months);

  const total = months.reduce(
    (acc, m) => {
      acc.sent += m.sent;
      acc.filled += m.filled;
      if (m.filled > 0 && m.sent > 0) acc.conversionSum += m.conversion;
      acc.npsSum += m.nps;
      acc.avgScoreSum += m.avgScore;
      acc.monthsWithData += (m.sent > 0 ? 1 : 0);
      return acc;
    },
    { sent: 0, filled: 0, conversionSum: 0, npsSum: 0, avgScoreSum: 0, monthsWithData: 0 }
  );

  return {
    months,
    year,
    total: {
      sent: total.sent,
      filled: total.filled,
      conversion: total.sent > 0
        ? Math.round((total.filled / total.sent) * 1000) / 10
        : 0,
      nps: total.monthsWithData > 0
        ? Math.round((total.npsSum / total.monthsWithData) * 10) / 10
        : 0,
      avgScore: total.monthsWithData > 0
        ? Math.round((total.avgScoreSum / total.monthsWithData) * 100) / 100
        : 0,
    },
  };
}

// ── Срезы ───────────────────────────────────────────────────────────────────────

/**
 * Словарь названий для срезов.
 * Ключи — ID списковых полей, значения — читаемые названия.
 */
const DICT = {
  // UF_CRM_1498466811 — Направления
  '1917': 'MBA', '35288': 'MMBA', '1924': 'Аналитика',
  '1912': 'Безопасность бизнеса', '1914': 'ВЭД', '1927': 'ГосКонтракты',
  '1925': 'ИТ', '32862': 'Клиентский опыт', '1906': 'Корп. обучение',
  '1904': 'Ком. недвижимость', '1903': 'Корп. право',
  '10758': 'Личная эффективность', '1905': 'Логистика',
  '1902': 'Продажи', '10747': 'Проектное управление',
  '1907': 'Строительство', '1923': 'Торговля',
  '1911': 'Управление БП', '1921': 'Управление маркетингом',
  '13609': 'Управление персоналом', '1913': 'Управление производством',
  '1915': 'Управление и стратегия', '1908': 'Управление финансами',
  '16471': 'Школа продаж',
  '34365': 'Продажи и коммерция', '35002': 'Строительство и девелопмент',
  '13615': 'Организация обучения', '10837': 'Архив',
  // UF_CRM_1672140275546 — B2B/B2C
  '18027': 'B2B', '18028': 'B2C', '18029': 'B2B/B2C',
};

/** Агрегирует NPS по значению поля (срез) */
export function aggregateBySlice(deals, year, fieldCode, labelMap = DICT) {
  const groups = {};

  for (const d of deals) {
    if (!isPostSaleSent(d)) continue;
    const dateStr = d.DATE_CREATE;
    if (!dateStr) continue;
    const dt = new Date(dateStr);
    if (dt.getFullYear() !== year) continue;

    const raw = d[fieldCode];
    if (!raw) continue;
    const key = String(raw);

    if (!groups[key]) {
      groups[key] = { sent: 0, filled: 0, promoters: 0, neutrals: 0, detractors: 0, scores: [] };
    }

    const g = groups[key];
    g.sent++;

    if (isPostSaleFilled(d)) {
      const status = getLearnerStatus(d);
      if (status !== null && status !== 'no_contact') {
        g.filled++;
        if (status === 'promoter')  g.promoters++;
        if (status === 'passive')   g.neutrals++;
        if (status === 'detractor') g.detractors++;
        const score = getNpsScore(d);
        if (score !== null) g.scores.push(score);
      }
    }
  }

  return Object.entries(groups)
    .filter(([_, g]) => g.filled > 0)
    .map(([key, g]) => {
      const total = g.promoters + g.neutrals + g.detractors;
      const nps = total > 0 ? Math.round(((g.promoters - g.detractors) / total) * 1000) / 10 : 0;
      const avgScore = g.scores.length > 0
        ? Math.round((g.scores.reduce((a, b) => a + b, 0) / g.scores.length) * 100) / 100
        : 0;
      return {
        id: key,
        label: labelMap[key] || key,
        sent: g.sent,
        filled: g.filled,
        conversion: g.sent > 0 ? Math.round((g.filled / g.sent) * 1000) / 10 : 0,
        promoters: g.promoters,
        neutrals: g.neutrals,
        detractors: g.detractors,
        detractorPct: total > 0 ? Math.round((g.detractors / total) * 1000) / 10 : 0,
        nps,
        avgScore,
      };
    })
    .sort((a, b) => b.nps - a.nps);
}

/**
 * Генерирует текстовые выводы на основе срезов и месячных данных.
 */
export function generateInsights(months, slices, total) {
  const insights = [];

  const lastMonth = [...months].reverse().find(m => m.sent > 0);

  // 1. Общий NPS
  if (total && total.sent > 0) {
    if (total.nps >= 80) {
      insights.push({ type: 'good', text: `Общий NPS за период: ${total.nps}% — отличный результат` });
    } else if (total.nps >= 50) {
      insights.push({ type: 'mid', text: `Общий NPS за период: ${total.nps}% — хороший, есть куда расти` });
    } else {
      insights.push({ type: 'bad', text: `Общий NPS за период: ${total.nps}% — требует внимания` });
    }
  }

  // 2. Динамика NPS
  if (lastMonth && lastMonth.npsGrowthAbs !== null && lastMonth.sent > 0) {
    const sign = lastMonth.npsGrowthAbs >= 0 ? '+' : '';
    if (lastMonth.npsGrowthAbs > 5) {
      insights.push({ type: 'good', text: `NPS вырос на ${sign}${lastMonth.npsGrowthAbs} п.п. относительно прошлого месяца` });
    } else if (lastMonth.npsGrowthAbs < -5) {
      insights.push({ type: 'bad', text: `NPS упал на ${sign}${lastMonth.npsGrowthAbs} п.п. относительно прошлого месяца — стоит проанализировать причины` });
    } else if (Math.abs(lastMonth.npsGrowthAbs) > 0) {
      insights.push({ type: 'neutral', text: `NPS изменился на ${sign}${lastMonth.npsGrowthAbs} п.п. относительно прошлого месяца` });
    }
  }

  // 3. Конверсия
  if (lastMonth && lastMonth.sent > 0) {
    if (lastMonth.conversion < 30) {
      insights.push({ type: 'bad', text: `Конверсия заполнения ${lastMonth.conversion}% — низкая, возможно проблема с доставкой анкет` });
    } else if (lastMonth.conversion < 50) {
      insights.push({ type: 'mid', text: `Конверсия заполнения ${lastMonth.conversion}% — средняя` });
    }
  }

  // 4. Детракторы в направлениях
  if (slices && slices.directions && slices.directions.length > 0) {
    const problemDirs = slices.directions.filter(d => d.detractorPct > 10 || d.nps < 70);
    if (problemDirs.length > 0) {
      const worst = problemDirs.slice(0, 3);
      const lines = worst.map(d => `${d.label} (NPS ${d.nps}%, детракторов ${d.detractorPct}%)`).join(', ');
      insights.push({ type: 'bad', text: `Направления с наибольшим числом детракторов: ${lines}` });
    }

    const best = slices.directions.filter(d => d.filled >= 5).slice(0, 3);
    if (best.length >= 3) {
      const lines = best.map(d => `${d.label} (${d.nps}%)`).join(', ');
      insights.push({ type: 'good', text: `Лучший NPS у направлений: ${lines}` });
    }
  }

  // 5. B2B vs B2C
  if (slices && slices.clientTypes && slices.clientTypes.length >= 2) {
    const b2b = slices.clientTypes.find(d => d.label === 'B2B');
    const b2c = slices.clientTypes.find(d => d.label === 'B2C');
    if (b2b && b2c && b2b.nps > 0 && b2c.nps > 0) {
      const diff = Math.round((b2b.nps - b2c.nps) * 10) / 10;
      if (Math.abs(diff) > 3) {
        if (diff > 0) {
          insights.push({ type: 'neutral', text: `B2B-клиенты оценивают выше B2C на ${diff} п.п. (${b2b.nps}% vs ${b2c.nps}%)` });
        } else {
          insights.push({ type: 'neutral', text: `B2C-клиенты оценивают выше B2B на ${Math.abs(diff)} п.п. (${b2c.nps}% vs ${b2b.nps}%)` });
        }
      }
    }
  }

  // 6. Тренд по году
  const monthsWithData = months.filter(m => m.sent > 0);
  if (monthsWithData.length >= 3) {
    const first = monthsWithData[0];
    const last = monthsWithData[monthsWithData.length - 1];
    const npsDiff = Math.round((last.nps - first.nps) * 10) / 10;
    if (npsDiff > 10) {
      insights.push({ type: 'good', text: `За год NPS вырос на ${npsDiff} п.п. — положительная динамика` });
    } else if (npsDiff < -10) {
      insights.push({ type: 'bad', text: `За год NPS снизился на ${Math.abs(npsDiff)} п.п. — негативный тренд` });
    }
  }

  return insights;
}

/**
 * Полная агрегация NPS: месяцы + срезы + итог + выводы.
 */
export async function getNpsAggFull(year) {
  let deals;
  try {
    const raw = await readFile(path.join(CACHE_DIR, 'post-sale-deals.json'), 'utf-8');
    deals = JSON.parse(raw);
  } catch (e) {
    return { months: [], year, total: { sent: 0, filled: 0, conversion: 0, nps: 0, avgScore: 0 }, insights: [] };
  }

  const months = aggregateByMonth(deals, year);
  addDeltas(months);

  const total = months.reduce(
    (acc, m) => {
      acc.sent += m.sent;
      acc.filled += m.filled;
      if (m.filled > 0 && m.sent > 0) acc.conversionSum += m.conversion;
      acc.npsSum += m.nps;
      acc.avgScoreSum += m.avgScore;
      acc.monthsWithData += (m.sent > 0 ? 1 : 0);
      return acc;
    },
    { sent: 0, filled: 0, conversionSum: 0, npsSum: 0, avgScoreSum: 0, monthsWithData: 0 }
  );

  // Срезы
  const directions = aggregateBySlice(deals, year, 'UF_CRM_1498466811');
  const formats = aggregateBySlice(deals, year, UF.FORMAT, FORMAT_MAP);
  const clientTypes = aggregateBySlice(deals, year, 'UF_CRM_1672140275546');

  const slices = { directions, formats, clientTypes };

  const totalObj = {
    sent: total.sent,
    filled: total.filled,
    conversion: total.sent > 0
      ? Math.round((total.filled / total.sent) * 1000) / 10
      : 0,
    nps: total.monthsWithData > 0
      ? Math.round((total.npsSum / total.monthsWithData) * 10) / 10
      : 0,
    avgScore: total.monthsWithData > 0
      ? Math.round((total.avgScoreSum / total.monthsWithData) * 100) / 100
      : 0,
  };

  const insights = generateInsights(months, slices, totalObj);

  return {
    months,
    year,
    slices,
    total: totalObj,
    insights,
  };
}