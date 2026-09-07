/**
 * index.js — точка входа для выгрузки данных из Bitrix24.
 *
 * ЗАПУСК: npm run fetch  (из папки data-service/, требует ../.env с BITRIX_BASE)
 *
 * Этот файл запускается ВРУЧНУЮ (или по расписанию) и НЕ участвует в работе
 * веб-сервера. Он последовательно выполняет шаги и сохраняет результаты
 * в папку cache/ — откуда их потом читает analyze.js при каждом запросе к дашборду.
 *
 * ШАГИ:
 *   1. bitrix-rest.js    → REST API crm.deal.list → все сделки (основной источник)
 *   2. bitrix-export.js  → Export API (старые сделки без STAGE_SEMANTIC_ID) + merge
 *      → cache/deals.json, cache/fetched_at.json
 *   3. bitrix-dicts.js   → справочники: воронки, стадии, пользователи, форматы, направления
 *      → cache/dicts.json
 *   4. bitrix-contacts.js → имена контактов и компаний по CONTACT_ID / COMPANY_ID из сделок
 *      → cache/contacts.json, cache/companies.json
 *   5. fetch-modules.js  → даты модулей программ для participants-dashboard
 *      → dashboards/participants-dashboard/cache/modules.json
 *   6. fetch-invoices.js → статусы счетов
 *      → cache/invoices.json
 *   7. bitrix-rest.js    → PostSale (CATEGORY_ID=9) для NPS-дашборда
 *      → cache/post-sale-deals.json
 *
 * ВРЕМЯ ВЫПОЛНЕНИЯ: ~20-40 минут (зависит от скорости Б24 и объёма данных).
 * Во время выполнения дашборды продолжают работать на старых данных из кэша.
 *
 * Прогресс-сообщения (###PROGRESS:...) читает rshu-dashboard для отображения
 * статуса загрузки.
 */

import { readFile, mkdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import { writeFileAtomic } from './lib/fs-utils.js';
import path from 'path';
import { fetchDealsRest } from './lib/bitrix-rest.js';
import { fetchDealsExport, mergeDeals } from './lib/bitrix-export.js';
import { fetchDicts } from './lib/bitrix-dicts.js';
import { fetchContacts, fetchCompanies } from './lib/bitrix-contacts.js';
import { fetchModules } from './lib/fetch-modules.js';
import { fetchInvoices } from './lib/fetch-invoices.js';
import { fetchPostSaleDeals } from './lib/bitrix-rest.js';
import { saveDailySnapshot } from './lib/snapshot.js';

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

await writeFileAtomic(
  path.join(CACHE_DIR, 'deals.json'),
  JSON.stringify(deals),
  'utf-8'
);
await writeFileAtomic(
  path.join(CACHE_DIR, 'fetched_at.json'),
  JSON.stringify({ fetchedAt: new Date().toISOString() }),
  'utf-8'
);
progress({ type: 'step_done', idx: 1 });
console.log(`  Сохранено: cache/deals.json (${elapsed()})`);

// --- Шаг 3: Справочники ---
console.log('\n== Шаг 3/3: Справочники ==');
progress({ type: 'step_start', idx: 2 });

const dicts = await fetchDicts(deals);

await writeFileAtomic(
  path.join(CACHE_DIR, 'dicts.json'),
  JSON.stringify(dicts, null, 2),
  'utf-8'
);
progress({ type: 'step_done', idx: 2 });
console.log(`  Сохранено: cache/dicts.json (${elapsed()})`);

// --- Шаг 4: Контакты и компании (для participants-dashboard) ---
console.log('\n== Шаг 4/4: Контакты и компании ==');
progress({ type: 'step_start', idx: 3 });

const contacts = await fetchContacts(deals);
await writeFileAtomic(
  path.join(CACHE_DIR, 'contacts.json'),
  JSON.stringify(contacts),
  'utf-8'
);
console.log(`  Сохранено: cache/contacts.json — ${Object.keys(contacts).length} контактов (${elapsed()})`);

const companies = await fetchCompanies(deals);
await writeFileAtomic(
  path.join(CACHE_DIR, 'companies.json'),
  JSON.stringify(companies),
  'utf-8'
);
console.log(`  Сохранено: cache/companies.json — ${Object.keys(companies).length} компаний (${elapsed()})`);

progress({ type: 'step_done', idx: 3 });

// --- Шаг 5: Модули участников (даты начала/конца каждого модуля программы) ---
console.log('\n== Шаг 5/5: Модули участников ==');
progress({ type: 'step_start', idx: 4 });

const MODULES_OUT = path.join(
  __dirname, '..', 'dashboards', 'participants-dashboard', 'cache', 'modules.json'
);
try {
  const { mkdir: mkdirFs } = await import('fs/promises');
  await mkdirFs(path.dirname(MODULES_OUT), { recursive: true });

  const modules = await fetchModules(deals, msg => console.log(msg));
  await writeFileAtomic(MODULES_OUT, JSON.stringify(modules));

  const withMods = Object.values(modules).filter(v => v.length > 0).length;
  console.log(`  Сохранено: modules.json — ${withMods} сделок с модулями (${elapsed()})`);
} catch (e) {
  console.error(`  Ошибка выгрузки модулей: ${e.message}`);
}
progress({ type: 'step_done', idx: 4 });

// --- Шаг 6: Инвойсы (статусы счетов) ---
console.log('\n== Шаг 6/6: Инвойсы ==');
progress({ type: 'step_start', idx: 5 });

try {
  await fetchInvoices(deals);
} catch (e) {
  console.error(`  Ошибка выгрузки инвойсов: ${e.message}`);
}
progress({ type: 'step_done', idx: 5 });

// --- Шаг 7: PostSale (NPS) — отдельный файл, не влияет на другие дашборды ---
console.log('\n== Шаг 7/7: PostSale (NPS) ==');
progress({ type: 'step_start', idx: 6 });

try {
  const postSaleDeals = await fetchPostSaleDeals((count) => {
    if (count % 500 === 0) progress({ type: 'postsale_loaded', count });
  });
  await writeFileAtomic(
    path.join(CACHE_DIR, 'post-sale-deals.json'),
    JSON.stringify(postSaleDeals),
    'utf-8'
  );
  console.log(`  Сохранено: cache/post-sale-deals.json — ${postSaleDeals.length} сделок (${elapsed()})`);
} catch (e) {
  console.error(`  Ошибка выгрузки PostSale: ${e.message}`);
}
progress({ type: 'step_done', idx: 6 });

// --- Шаг 8: Ежедневный снапшот портфеля (для разбивки «Остатка на конец» по этапам
// на прошлые даты — см. portfolio-flow.js). Дата = дата fetched_at (срез кэша). ---
console.log('\n== Шаг 8/8: Снапшот портфеля ==');
progress({ type: 'step_start', idx: 7 });
try {
  const snapDate = new Date().toISOString().slice(0, 10); // дата выгрузки (UTC, как fetched_at)
  const n = saveDailySnapshot(deals, snapDate);
  console.log(`  Сохранено: cache/snapshots/${snapDate}.json — ${n} сделок «в работе» (${elapsed()})`);
} catch (e) {
  console.error(`  Ошибка снапшота: ${e.message}`);
}
progress({ type: 'step_done', idx: 7 });

// --- Готово ---
progress({ type: 'all_done' });
console.log(`\n== Готово за ${elapsed()} ==`);
console.log(`  deals.json    — ${deals.length} сделок`);
console.log(`  dicts.json    — ${Object.keys(dicts.categories).length} воронок, ${Object.keys(dicts.users).length} пользователей`);
console.log(`  contacts.json — ${Object.keys(contacts).length} контактов`);
console.log(`  companies.json — ${Object.keys(companies).length} компаний`);
try {
  const inv = JSON.parse(await readFile(path.join(CACHE_DIR, 'invoices.json'), 'utf-8'));
  console.log(`  invoices.json — ${Object.keys(inv).length} инвойсов`);
} catch { /* шаг 6 мог упасть — не критично */ }