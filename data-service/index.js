/**
 * index.js — точка входа для выгрузки данных из Bitrix24.
 * Запуск: npm run fetch (из data-service/)
 * Шаги: REST → Export → Справочники → Контакты → Модули → Инвойсы → PostSale
 */

import { readFile, mkdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import { writeFileAtomic } from './lib/fs-utils.js';
import path from 'path';
import { fetchDealsRest, fetchPostSaleDeals } from './lib/bitrix-rest.js';
import { fetchDealsExport, mergeDeals } from './lib/bitrix-export.js';
import { fetchDicts } from './lib/bitrix-dicts.js';
import { fetchContacts, fetchCompanies } from './lib/bitrix-contacts.js';
import { fetchModules } from './lib/fetch-modules.js';
import { fetchInvoices } from './lib/fetch-invoices.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, 'cache');

if (!process.env.BITRIX_BASE) {
  console.error('ERROR: BITRIX_BASE не задан');
  process.exit(1);
}

function progress(msg) { process.stdout.write(`###PROGRESS:${JSON.stringify(msg)}\n`); }
const t0 = Date.now();
function elapsed() { return ((Date.now() - t0) / 1000).toFixed(1) + 's'; }

await mkdir(CACHE_DIR, { recursive: true });

console.log('\n== Шаг 1/3: REST API crm.deal.list ==');
progress({ type: 'step_start', idx: 0 });
let lastReported = 0;
const restDeals = await fetchDealsRest((count) => {
  if (count - lastReported >= 150) { progress({ type: 'deals_loaded', count }); lastReported = count; }
});
progress({ type: 'deals_loaded', count: restDeals.length });
progress({ type: 'step_done', idx: 0 });
console.log(`  Загружено: ${restDeals.length} сделок (${elapsed()})`);

console.log('\n== Шаг 2/3: Export API ==');
progress({ type: 'step_start', idx: 1 });
const exportDeals = await fetchDealsExport();
const deals = mergeDeals(restDeals, exportDeals);
await writeFileAtomic(path.join(CACHE_DIR, 'deals.json'), JSON.stringify(deals), 'utf-8');
await writeFileAtomic(path.join(CACHE_DIR, 'fetched_at.json'), JSON.stringify({ fetchedAt: new Date().toISOString() }), 'utf-8');
progress({ type: 'step_done', idx: 1 });
console.log(`  Сохранено: cache/deals.json (${elapsed()})`);

console.log('\n== Шаг 3/3: Справочники ==');
progress({ type: 'step_start', idx: 2 });
await writeFileAtomic(path.join(CACHE_DIR, 'dicts.json'), JSON.stringify(await fetchDicts(deals), null, 2), 'utf-8');
progress({ type: 'step_done', idx: 2 });
console.log(`  Сохранено: cache/dicts.json (${elapsed()})`);

console.log('\n== Шаг 4/4: Контакты и компании ==');
progress({ type: 'step_start', idx: 3 });
const contacts = await fetchContacts(deals);
await writeFileAtomic(path.join(CACHE_DIR, 'contacts.json'), JSON.stringify(contacts), 'utf-8');
const companies = await fetchCompanies(deals);
await writeFileAtomic(path.join(CACHE_DIR, 'companies.json'), JSON.stringify(companies), 'utf-8');
progress({ type: 'step_done', idx: 3 });

console.log('\n== Шаг 5/5: Модули участников ==');
progress({ type: 'step_start', idx: 4 });
const MODULES_OUT = path.join(__dirname, '..', 'dashboards', 'participants-dashboard', 'cache', 'modules.json');
try {
  const { mkdir: mk } = await import('fs/promises');
  await mk(path.dirname(MODULES_OUT), { recursive: true });
  await writeFileAtomic(MODULES_OUT, JSON.stringify(await fetchModules(deals, m => console.log(m))));
} catch (e) { console.error('  Ошибка модулей:', e.message); }
progress({ type: 'step_done', idx: 4 });

console.log('\n== Шаг 6/6: Инвойсы ==');
progress({ type: 'step_start', idx: 5 });
try { await fetchInvoices(deals); } catch (e) { console.error('  Ошибка инвойсов:', e.message); }
progress({ type: 'step_done', idx: 5 });

console.log('\n== Шаг 7/7: PostSale (NPS) ==');
progress({ type: 'step_start', idx: 6 });
try {
  const postSaleDeals = await fetchPostSaleDeals(c => { if (c % 500 === 0) progress({ type: 'postsale_loaded', count: c }); });
  await writeFileAtomic(path.join(CACHE_DIR, 'post-sale-deals.json'), JSON.stringify(postSaleDeals), 'utf-8');
  console.log(`  Сохранено: cache/post-sale-deals.json — ${postSaleDeals.length} сделок (${elapsed()})`);
} catch (e) { console.error('  Ошибка PostSale:', e.message); }
progress({ type: 'step_done', idx: 6 });

progress({ type: 'all_done' });
console.log(`\n== Готово за ${elapsed()} ==`);
