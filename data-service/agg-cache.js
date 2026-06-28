/**
 * agg-cache.js — shared in-memory cache for analyze() result.
 * All dashboards import getAgg() from here instead of running analyze() themselves.
 */

import { analyze } from './analyze.js';

const CACHE_TTL_MS = 60 * 1000;

let aggCache = null;
let aggCacheAt = 0;
let analyzing = null;

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
    throw e;
  });
  return analyzing;
}

export function getCacheAt() { return aggCacheAt; }
