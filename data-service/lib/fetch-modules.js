/**
 * fetch-modules.js — выгрузка модулей программ с датами для participants-dashboard.
 *
 * ВЫЗЫВАЕТСЯ: из index.js (Шаг 5) во время npm run fetch.
 *   Принимает на вход уже загруженный массив deals (ID берутся из него).
 *
 * ЗАЧЕМ:
 *   participants-dashboard показывает кто учится НА ЭТОЙ НЕДЕЛЕ.
 *   Если брать только даты начала/конца программы (UF_CRM_DATE_START_LEARN / END_LEARN),
 *   то участник MBA (6 месяцев) попадает в таблицу каждую неделю полгода — это неверно.
 *   Правильная логика: показывать участника только на неделях, когда идёт его МОДУЛЬ.
 *
 * ЧТО ДЕЛАЕТ:
 *   1. Из deals выбирает активные сделки воронки 0 (стадии WON, PROPOSAL, 2, 6 и их C0:-варианты)
 *   2. Для каждой сделки запрашивает Export API с WITH_PRODUCTS=Y
 *   3. Из ответа извлекает MODULES[] → свойство 223 (дата начала), 224 (дата конца модуля)
 *      и DIRECTIONS / 851 («Направления» — направление недели, множественное)
 *      Инфоблок 52 в Б24, поля: PROPERTY_MODULE_DATE_START_VALUE, PROPERTY_MODULE_DATE_END_VALUE
 *   4. Конвертирует даты из DD.MM.YYYY → YYYY-MM-DD
 *
 * РЕЗУЛЬТАТ: { dealId: [{ product_id, product_name, original_name, date_start, date_end,
 *                          directions }] }  — directions: ID элементов свойства DIRECTIONS (851)
 *   Сохраняется в dashboards/participants-dashboard/cache/modules.json
 *
 * ПРОИЗВОДИТЕЛЬНОСТЬ: ~7 680 сделок батчами по 10 → ~768 запросов × 200мс ≈ 3 минуты.
 *   Таймаут на каждый батч: 20 секунд.
 *
 * ВАЖНО: Export API требует плоский PHP-формат параметров (не JSON):
 *   data[FILTER][ID][0]=123&data[FILTER][ID][1]=456  — так работает
 *   data={"FILTER":{"ID":[123,456]}}                 — НЕ работает
 */

const EXPORT_URL  = 'https://24.uprav.ru/web_services/crm/export.php';
const SECRET      = '14b0fc053c141e47a5974b3859f5753f';
const BATCH_SIZE  = 10;
const DELAY_MS    = 200;

const ACTIVE_STAGES = new Set(['WON', 'PROPOSAL', '2', '6', 'C0:WON', 'C0:PROPOSAL', 'C0:2', 'C0:6']);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// API возвращает даты как DD.MM.YYYY — конвертируем в YYYY-MM-DD
function toIso(s) {
  if (!s) return null;
  s = String(s).trim();
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(s)) return `${s.slice(6)}-${s.slice(3,5)}-${s.slice(0,2)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  return null;
}

function extractDate(mod, propId, ...codes) {
  const byId = mod[`PROPERTY_${propId}_VALUE`];
  if (byId) return toIso(byId);
  for (const code of codes) {
    const val = mod[`PROPERTY_${code}_VALUE`];
    if (val) return toIso(val);
  }
  return null;
}

// «Направление недели» с карточки модуля: инфоблок 52, свойство DIRECTIONS (ID 851),
// привязка к элементу, множественное. API отдаёт МАССИВ ID элементов без названий
// (в отличие от HNDBK-свойств, для которых приходит *_NAME), поэтому сохраняем ID
// как есть — расшифровка в названия делается на стороне дашборда по справочнику.
function extractDirections(mod) {
  const v = mod.PROPERTY_DIRECTIONS_VALUE ?? mod.PROPERTY_851_VALUE;
  const arr = Array.isArray(v) ? v : (v ? [v] : []);
  return arr.filter(Boolean).map(String);
}

function parseModules(deal) {
  if (!deal?.PRODUCTS) return [];
  const { products = [], MODULES = [] } = deal.PRODUCTS;
  const modById = Object.fromEntries(MODULES.map(m => [m.ID, m]));
  const out = [];
  for (const prod of products) {
    for (const mId of (prod.modules_ids || [])) {
      const m = modById[mId];
      if (!m) continue;
      const dateStart = extractDate(m, '223', 'MODULE_DATE_START', 'DATE_START');
      const dateEnd   = extractDate(m, '224', 'MODULE_DATE_END',   'DATE_END');
      if (!dateStart) continue;
      out.push({
        product_id:    String(prod.ID || mId),
        product_name:  prod.PRODUCT_NAME || null,
        original_name: m.NAME || null,
        date_start:    dateStart,
        date_end:      dateEnd || dateStart,
        directions:    extractDirections(m),
      });
    }
  }
  return out;
}

async function fetchBatch(ids) {
  const params = [
    ['secret', SECRET],
    ['action', 'getDeals'],
    ...ids.map((id, i) => [`data[FILTER][ID][${i}]`, id]),
    ['data[SELECT][0]', 'ID'],
    [`data[nav][limit]`,  String(ids.length)],
    ['data[nav][offset]', '0'],
    ['data[WITH_PRODUCTS]', 'Y'],
  ];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(EXPORT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
      signal: controller.signal,
    });
    const json = await res.json();
    if (!json.success) throw new Error(`Export API: ${JSON.stringify(json.errors)}`);
    return json.data?.items || [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {Array} deals — массив сделок из deals.json (уже загруженный)
 * @param {Function} onProgress — колбэк для вывода прогресса
 */
export async function fetchModules(deals, onProgress) {
  const ids = deals
    .filter(d => String(d.CATEGORY_ID) === '0' && ACTIVE_STAGES.has(d.STAGE_ID))
    .map(d => d.ID);

  onProgress?.(`  Активных сделок cat=0: ${ids.length} (батчи по ${BATCH_SIZE})`);

  const result = {};

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    if (i % 200 === 0) onProgress?.(`  [${i}/${ids.length}] обработано...`);

    try {
      const items = await fetchBatch(batch);
      for (const deal of items) {
        result[deal.ID] = parseModules(deal);
      }
      // Сделки без ответа — пустой массив
      for (const id of batch) {
        if (!(id in result)) result[id] = [];
      }
    } catch (e) {
      for (const id of batch) result[id] = [];
    }

    await sleep(DELAY_MS);
  }

  const withMods = Object.values(result).filter(v => v.length > 0).length;
  onProgress?.(`  Сделок с модулями: ${withMods}`);

  return result;
}
