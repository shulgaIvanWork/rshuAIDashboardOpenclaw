/**
 * Выгружает модули (с датами) для активных сделок cat=0 через Export API WITH_PRODUCTS=Y.
 * Результат: { dealId: [{ product_id, product_name, original_name, date_start, date_end }] }
 *
 * Свойство 223 = дата начала модуля, 224 = дата конца (инфоблок 52 Б24).
 * ID сделок берутся из уже загруженного deals.json — не нужно листать Export API заново.
 * Запросы идут батчами по BATCH_SIZE штук за раз.
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
