/**
 * agg-cache.js — общий in-memory кэш агрегированных данных для всех дашбордов.
 *
 * ЗАЧЕМ:
 *   analyze() читает 3 JSON-файла и обрабатывает ~28 000 сделок — это тяжёлая
 *   операция. Без кэша каждый HTTP-запрос к любому дашборду запускал бы её заново.
 *   agg-cache.js запускает analyze() один раз, держит результат в памяти 5 минут,
 *   и отдаёт его всем дашбордам мгновенно.
 *
 * КАК ИСПОЛЬЗУЕТСЯ:
 *   Каждый server.js дашборда импортирует:
 *     import { getAgg, getCacheAt } from '@rshu/data-service/agg-cache.js'
 *   И вызывает:
 *     const d = await getAgg()   → полный объект с агрегатами (ytd, weeks, reg_ytd, ...)
 *     getCacheAt()               → timestamp последнего успешного analyze()
 *
 * ПОВЕДЕНИЕ ПРИ ОШИБКЕ:
 *   Если analyze() падает (например, deals.json сейчас перезаписывается во время
 *   npm run fetch), getAgg() возвращает СТАРЫЙ кэш вместо того чтобы бросать ошибку.
 *   Это позволяет дашбордам продолжать работать на устаревших данных, а не падать.
 *
 * TTL: 5 минут. После истечения следующий запрос к getAgg() запустит analyze() заново.
 */

import { analyze } from './analyze.js';
import { getNpsAggFull } from './analyze-nps.js';
import { YEAR } from '@rshu/data-service/lib/deal-rules.js';

const CACHE_TTL_MS = 5 * 60 * 1000;

let aggCache = null;
let aggCacheAt = 0;
let analyzing = null;

// NPS-кэш (отдельный, не влияет на основные данные)
let npsCache = null;
let npsCacheAt = 0;
let npsAnalyzing = null;

export async function getAgg() {
  if (aggCache && (Date.now() - aggCacheAt) < CACHE_TTL_MS) return aggCache;
  if (analyzing) return analyzing;
  analyzing = analyze().then(result => {
    aggCache = result;
    aggCacheAt = Date.now();
    analyzing = null;
    return result;
  }).catch(e => {
    analyzing = null;
    if (aggCache) {
      // Данные временно недоступны (идёт обновление) — отдаём старый кэш
      console.warn('[agg-cache] analyze() failed, serving stale cache:', e.message);
      return aggCache;
    }
    throw e;
  });
  return analyzing;
}

export function getCacheAt() { return aggCacheAt; }

/**
 * Возвращает агрегированные NPS-данные (с собственным in-memory кэшем).
 * Не зависит от основного analyze() — читает отдельный файл post-sale-deals.json.
 */
export async function getNps(forcedYear) {
  const year = forcedYear || YEAR;
  if (npsCache && (Date.now() - npsCacheAt) < CACHE_TTL_MS) return npsCache;
  if (npsAnalyzing) return npsAnalyzing;
  npsAnalyzing = getNpsAggFull(year).then(result => {
    npsCache = result;
    npsCacheAt = Date.now();
    npsAnalyzing = null;
    return result;
  }).catch(e => {
    npsAnalyzing = null;
    if (npsCache) {
      console.warn('[agg-cache] getNpsAgg() failed, serving stale cache:', e.message);
      return npsCache;
    }
    throw e;
  });
  return npsAnalyzing;
}