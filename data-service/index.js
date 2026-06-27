/**
 * data-service — центральная выгрузка данных из Bitrix24
 *
 * Запуск: npm run fetch  (из папки data-service/)
 *
 * Результат:
 *   cache/deals.json  — все сделки (REST + Export, смержены)
 *   cache/dicts.json  — справочники (воронки, стадии, источники, пользователи)
 */

import { writeFile, mkdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';
import { fetchDealsRest } from './lib/bitrix-rest.js';
import { fetchDealsExport, mergeDeals } from './lib/bitrix-export.js';
import { fetchDicts } from './lib/bitrix-dicts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, 'cache');

if (!process.env.BITRIX_BASE) {
  console.error('ERROR: BITRIX_BASE не задан. Запускай через npm run fetch или передай --env-file=../.env');
  process.exit(1);
}

function progress(msg) {
  process.stdout.write(`###PROGRESS:${JSON.stringify(msg)}\n`);
}

const t0 = Date.now();

function elapsed() {
  return ((Date.now() - t0) / 1000).toFixed(1) + 's';
}

await mkdir(CACHE_DIR, { recursive: true });

// --- Шаг 1: REST API ---
console.log('\n== Шаг 1/3: REST API crm.deal.list ==');
progress({ type: 'step_start', idx: 0 });

let lastReported = 0;
const restDeals = await fetchDealsRest((count) => {
  if (count - lastReported >= 150) {
    progress({ type: 'deals_loaded', count });
    lastReported = count;
  }
});
progress({ type: 'deals_loaded', count: restDeals.length });
progress({ type: 'step_done', idx: 0 });
console.log(`  Загружено: ${restDeals.length} сделок (${elapsed()})`);

// --- Шаг 2: Export API ---
console.log('\n== Шаг 2/3: Export API ==');
progress({ type: 'step_start', idx: 1 });

const exportDeals = await fetchDealsExport();
console.log(`  Из Export API: ${exportDeals.length} сделок`);

const deals = mergeDeals(restDeals, exportDeals);
console.log(`  После мержа: ${deals.length} сделок`);

await writeFile(
  path.join(CACHE_DIR, 'deals.json'),
  JSON.stringify(deals),
  'utf-8'
);
progress({ type: 'step_done', idx: 1 });
console.log(`  Сохранено: cache/deals.json (${elapsed()})`);

// --- Шаг 3: Справочники ---
console.log('\n== Шаг 3/3: Справочники ==');
progress({ type: 'step_start', idx: 2 });

const dicts = await fetchDicts(deals);

await writeFile(
  path.join(CACHE_DIR, 'dicts.json'),
  JSON.stringify(dicts, null, 2),
  'utf-8'
);
progress({ type: 'step_done', idx: 2 });
console.log(`  Сохранено: cache/dicts.json (${elapsed()})`);

// --- Готово ---
progress({ type: 'all_done' });
console.log(`\n== Готово за ${elapsed()} ==`);
console.log(`  deals.json  — ${deals.length} сделок`);
console.log(`  dicts.json  — ${Object.keys(dicts.categories).length} воронок, ${Object.keys(dicts.users).length} пользователей`);
