/**
 * analyze-nps.js — Расчёт NPS-метрик из сделок PostSale.
 *
 * Читает cache/post-sale-deals.json.
 * Категории NPS из UF_CRM_5DF2528C641D4 (Статус участника обучения).
 * Форматы, направления, B2B/B2C — из полей PostSale.
 *
 * НЕ влияет на другие дашборды — отдельный файл post-sale-deals.json.
 */

import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  POSTSALE_SENT_STAGES, POSTSALE_FILLED_STAGES,
  LEARNER_STATUS, UF,
} from '@rshu/data-service/lib/deal-rules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, 'cache');

function stripStagePrefix(stageId) {
  return String(stageId || '').replace(/^C\d+:/, '');
}

export function isPostSaleSent(d) {
  return POSTSALE_SENT_STAGES.has(stripStagePrefix(d.STAGE_ID));
}

export function isPostSaleFilled(d) {
  return POSTSALE_FILLED_STAGES.has(stripStagePrefix(d.STAGE_ID));
}

export function getNpsScore(d) {
  const val = d[UF.NPS_SCORE];
  if (val === null || val === undefined || val === '' || val === false) return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

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
    if (!months[m]) months[m] = { month: m, year: y, sent: 0, filled: 0, promoters: 0, neutrals: 0, detractors: 0, scores: [] };
    const md = months[m];
    md.sent++;
    if (isPostSaleFilled(d)) {
      const status = getLearnerStatus(d);
      if (status !== null && status !== 'no_contact') {
        md.filled++;
        if (status === 'promoter')  md.promoters++;
        if (status === 'passive')   md.neutrals++;
        if (status === 'detractor') md.detractors++;
        const score = getNpsScore(d);
        if (score !== null) md.scores.push(score);
      }
    }
  }
  const result = [];
  for (let m = 1; m <= 12; m++) {
    const md = months[m];
    if (!md || md.sent === 0) {
      result.push({ month: m, year, sent: 0, notFilled: 0, filled: 0, conversion: 0, promoters: 0, neutrals: 0, detractors: 0, detractorPct: 0, nps: 0, avgScore: 0 });
      continue;
    }
    const sent = md.sent, filled = md.filled, notFilled = sent - filled;
    const conversion = sent > 0 ? Math.round((filled / sent) * 1000) / 10 : 0;
    const totalCat = md.promoters + md.neutrals + md.detractors;
    const detractorPct = totalCat > 0 ? Math.round((md.detractors / totalCat) * 1000) / 10 : 0;
    const nps = totalCat > 0 ? Math.round(((md.promoters - md.detractors) / totalCat) * 1000) / 10 : 0;
    const avgScore = md.scores.length > 0 ? Math.round((md.scores.reduce((a, b) => a + b, 0) / md.scores.length) * 100) / 100 : 0;
    result.push({ month: m, year, sent, notFilled, filled, conversion, promoters: md.promoters, neutrals: md.neutrals, detractors: md.detractors, detractorPct, nps, avgScore });
  }
  return result;
}

function addDeltas(months) {
  for (let i = 0; i < months.length; i++) {
    const cur = months[i], prev = i > 0 ? months[i - 1] : null;
    cur.conversionGrowth = null; cur.filledGrowth = null; cur.filledGrowthAbs = null; cur.npsGrowth = null; cur.npsGrowthAbs = null;
    if (!prev || prev.sent === 0) continue;
    cur.conversionGrowth = prev.conversion > 0 ? Math.round(((cur.conversion - prev.conversion) / prev.conversion) * 1000) / 10 : cur.conversion > 0 ? 100 : null;
    cur.filledGrowth = prev.filled > 0 ? Math.round(((cur.filled - prev.filled) / prev.filled) * 1000) / 10 : null;
    cur.filledGrowthAbs = cur.filled - prev.filled;
    cur.npsGrowth = prev.nps !== 0 ? Math.round(((cur.nps - prev.nps) / Math.abs(prev.nps)) * 1000) / 10 : null;
    cur.npsGrowthAbs = Math.round((cur.nps - prev.nps) * 10) / 10;
  }
}

const DICT = {
  '1917':'MBA','35288':'MMBA','1924':'Аналитика','1912':'Безопасность бизнеса','1914':'ВЭД','1927':'ГосКонтракты',
  '1925':'ИТ','32862':'Клиентский опыт','1906':'Корп. обучение','1904':'Ком. недвижимость','1903':'Корп. право',
  '10758':'Личная эффективность','1905':'Логистика','1902':'Продажи','10747':'Проектное управление',
  '1907':'Строительство','1923':'Торговля','1911':'Управление БП','1921':'Управление маркетингом',
  '13609':'Управление персоналом','1913':'Управление производством','1915':'Управление и стратегия',
  '1908':'Управление финансами','16471':'Школа продаж','34365':'Продажи и коммерция',
  '35002':'Строительство и девелопмент','13615':'Организация обучения','10837':'Архив',
  '33559':'Очно в РШУ','33560':'Очно у заказчика','33561':'Очно выезд/аренда','33562':'Онлайн','33563':'Видео',
  '18027':'B2B','18028':'B2C','18029':'B2B/B2C',
};

export function aggregateBySlice(deals, year, fieldCode) {
  const groups = {};
  for (const d of deals) {
    if (!isPostSaleSent(d)) continue;
    if (!d.DATE_CREATE) continue;
    const dt = new Date(d.DATE_CREATE);
    if (dt.getFullYear() !== year) continue;
    const raw = d[fieldCode];
    if (!raw) continue;
    const key = String(raw);
    if (!groups[key]) groups[key] = { sent: 0, filled: 0, promoters: 0, neutrals: 0, detractors: 0, scores: [] };
    const g = groups[key]; g.sent++;
    if (isPostSaleFilled(d)) {
      const status = getLearnerStatus(d);
      if (status !== null && status !== 'no_contact') {
        g.filled++;
        if (status === 'promoter') g.promoters++;
        else if (status === 'passive') g.neutrals++;
        else if (status === 'detractor') g.detractors++;
        const score = getNpsScore(d);
        if (score !== null) g.scores.push(score);
      }
    }
  }
  return Object.entries(groups).filter(([_,g]) => g.filled > 0).map(([key,g]) => {
    const total = g.promoters + g.neutrals + g.detractors;
    const nps = total > 0 ? Math.round(((g.promoters - g.detractors) / total) * 1000) / 10 : 0;
    const avgScore = g.scores.length > 0 ? Math.round((g.scores.reduce((a,b) => a+b, 0) / g.scores.length) * 100) / 100 : 0;
    return { id: key, label: DICT[key] || key, sent: g.sent, filled: g.filled, conversion: g.sent > 0 ? Math.round((g.filled / g.sent) * 1000) / 10 : 0, promoters: g.promoters, neutrals: g.neutrals, detractors: g.detractors, detractorPct: total > 0 ? Math.round((g.detractors / total) * 1000) / 10 : 0, nps, avgScore };
  }).sort((a,b) => b.nps - a.nps);
}

export function generateInsights(months, slices, total) {
  const insights = [];
  const lastMonth = [...months].reverse().find(m => m.sent > 0);
  if (total && total.sent > 0) {
    insights.push({ type: total.nps >= 80 ? 'good' : total.nps >= 50 ? 'mid' : 'bad', text: `Общий NPS за период: ${total.nps}% — ${total.nps >= 80 ? 'отличный результат' : total.nps >= 50 ? 'хороший, есть куда расти' : 'требует внимания'}` });
  }
  if (lastMonth && lastMonth.npsGrowthAbs !== null && lastMonth.sent > 0) {
    const sign = lastMonth.npsGrowthAbs >= 0 ? '+' : '';
    if (lastMonth.npsGrowthAbs > 5) insights.push({ type: 'good', text: `NPS вырос на ${sign}${lastMonth.npsGrowthAbs} п.п. относительно прошлого месяца` });
    else if (lastMonth.npsGrowthAbs < -5) insights.push({ type: 'bad', text: `NPS упал на ${sign}${lastMonth.npsGrowthAbs} п.п. относительно прошлого месяца — стоит проанализировать причины` });
    else if (Math.abs(lastMonth.npsGrowthAbs) > 0) insights.push({ type: 'neutral', text: `NPS изменился на ${sign}${lastMonth.npsGrowthAbs} п.п. относительно прошлого месяца` });
  }
  if (slices && slices.directions && slices.directions.length > 0) {
    const problemDirs = slices.directions.filter(d => d.detractorPct > 10 || d.nps < 70);
    if (problemDirs.length > 0) insights.push({ type: 'bad', text: 'Проблемные направления: ' + problemDirs.slice(0,3).map(d => `${d.label} (NPS ${d.nps}%, детр. ${d.detractorPct}%)`).join(', ') });
    const best = slices.directions.filter(d => d.filled >= 5).slice(0, 3);
    if (best.length >= 3) insights.push({ type: 'good', text: 'Лучший NPS: ' + best.map(d => `${d.label} (${d.nps}%)`).join(', ') });
  }
  if (slices && slices.clientTypes && slices.clientTypes.length >= 2) {
    const b2b = slices.clientTypes.find(d => d.label === 'B2B');
    const b2c = slices.clientTypes.find(d => d.label === 'B2C');
    if (b2b && b2c && Math.abs(b2b.nps - b2c.nps) > 3) {
      insights.push({ type: 'neutral', text: (b2b.nps > b2c.nps ? 'B2B' : 'B2C') + '-клиенты оценивают выше на ' + Math.round(Math.abs(b2b.nps - b2c.nps) * 10) / 10 + ' п.п.' });
    }
  }
  const mwd = months.filter(m => m.sent > 0);
  if (mwd.length >= 3) {
    const diff = Math.round((mwd[mwd.length-1].nps - mwd[0].nps) * 10) / 10;
    if (Math.abs(diff) > 10) insights.push({ type: diff > 0 ? 'good' : 'bad', text: `За год NPS ${diff > 0 ? 'вырос' : 'снизился'} на ${Math.abs(diff)} п.п. — ${diff > 0 ? 'положительная' : 'негативный'} ${diff > 0 ? 'динамика' : 'тренд'}` });
  }
  return insights;
}

export async function getNpsAggFull(year) {
  let deals;
  try {
    deals = JSON.parse(await readFile(path.join(CACHE_DIR, 'post-sale-deals.json'), 'utf-8'));
  } catch (e) {
    return { months: [], year, total: { sent:0,filled:0,conversion:0,nps:0,avgScore:0 }, insights: [] };
  }
  const months = aggregateByMonth(deals, year);
  addDeltas(months);
  const total = months.reduce((acc,m) => {
    if (m.sent > 0) { acc.sent += m.sent; acc.filled += m.filled; acc.months++;
      if (m.filled > 0 && m.sent > 0) acc.conversionSum += m.conversion;
      acc.npsSum += m.nps; acc.avgScoreSum += m.avgScore; }
    return acc;
  }, { sent:0, filled:0, conversionSum:0, npsSum:0, avgScoreSum:0, months:0 });
  const slices = {
    directions: aggregateBySlice(deals, year, 'UF_CRM_1498466811'),
    formats: aggregateBySlice(deals, year, 'UF_CRM_1744961443398'),
    clientTypes: aggregateBySlice(deals, year, 'UF_CRM_1672140275546'),
  };
  const totalObj = {
    sent: total.sent, filled: total.filled,
    conversion: total.sent > 0 ? Math.round((total.filled / total.sent) * 1000) / 10 : 0,
    nps: total.months > 0 ? Math.round((total.npsSum / total.months) * 10) / 10 : 0,
    avgScore: total.months > 0 ? Math.round((total.avgScoreSum / total.months) * 100) / 100 : 0,
  };
  return { months, year, slices, total: totalObj, insights: generateInsights(months, slices, totalObj) };
}
