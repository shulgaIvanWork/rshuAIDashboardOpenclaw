/**
 * agg-cache.js — общий in-memory кэш.
 */

import { analyze } from './analyze.js';
import { getNpsAggFull } from './analyze-nps.js';
import { YEAR } from '@rshu/data-service/lib/deal-rules.js';

const CACHE_TTL_MS = 5 * 60 * 1000;

let aggCache = null;
let aggCacheAt = 0;
let analyzing = null;

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
      console.warn('[agg-cache] analyze() failed, serving stale cache:', e.message);
      return aggCache;
    }
    throw e;
  });
  return analyzing;
}

export function getCacheAt() { return aggCacheAt; }

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
