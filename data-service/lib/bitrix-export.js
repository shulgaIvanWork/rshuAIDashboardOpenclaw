/**
 * Выгрузка сделок через CRM Export API.
 * Используется как второй проход — даёт сделки которых нет в REST
 * (старые сделки без STAGE_SEMANTIC_ID).
 * REST-данные имеют приоритет при мерже.
 */

const EXPORT_URL = 'https://24.uprav.ru/web_services/crm/export.php';
const SECRET = '14b0fc053c141e47a5974b3859f5753f';
const CATEGORIES = [0, 8, 19];
const LIMIT = 50;
const MAX_OFFSET = 5000;
const DELAY_MS = 500;

const SELECT = [
  'ID', 'TITLE', 'STAGE_ID', 'STAGE_SEMANTIC_ID', 'CATEGORY_ID',
  'OPPORTUNITY', 'CURRENCY_ID', 'DATE_CREATE', 'DATE_MODIFY',
  'CLOSEDATE', 'CLOSED', 'ASSIGNED_BY_ID', 'SOURCE_ID',
  'COMPANY_ID', 'CONTACT_ID',
  'UF_DATE_PAY_1C',
  'UF_FORMAT', 'UF_CRM_1498466811',
  'UF_CRM_1683882427069',
  'UF_CRM_1765896709800',
  'UF_CRM_1753272713011',
  'UF_CRM_1753341391806',
  'UF_CRM_DATE_START_LEARN', 'UF_CRM_DATE_END_LEARN',
];

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchPage(params) {
  const body = new URLSearchParams(params).toString();
  const res = await fetch(EXPORT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  return res.json();
}

function extractYear(dateStr) {
  if (!dateStr || dateStr.length < 4) return '';
  // Export API возвращает DD.MM.YYYY, REST — ISO
  if (dateStr.includes('.')) return dateStr.slice(6, 10);
  return dateStr.slice(0, 4);
}

export async function fetchDealsExport() {
  const all = new Map();

  for (const catId of CATEGORIES) {
    let offset = 0;
    while (offset <= MAX_OFFSET) {
      const params = [
        ['secret', SECRET],
        ['action', 'getDeals'],
        ['data[FILTER][=CATEGORY_ID]', catId],
        ['data[nav][limit]', LIMIT],
        ['data[nav][offset]', offset],
        ...SELECT.map((f, i) => [`data[SELECT][${i}]`, f]),
      ];

      try {
        const resp = await fetchPage(params);
        if (!resp.success) break;
        const items = resp.data?.items || [];
        if (!items.length) break;
        for (const d of items) all.set(d.ID, d);
        if (!resp.data?.nav?.nextOffset) break;
        offset = resp.data.nav.nextOffset;
      } catch (e) {
        process.stderr.write(`  [CAT ${catId}] offset=${offset} error: ${e.message}\n`);
        break;
      }
      await sleep(DELAY_MS);
    }
    process.stdout.write(`  [CAT ${catId}] загружено: ${[...all.values()].filter(d => String(d.CATEGORY_ID) === String(catId)).length}\n`);
  }

  // Фильтр 2025-2026
  return [...all.values()].filter(d => {
    const y = extractYear(d.DATE_CREATE || '');
    return y === '2025' || y === '2026';
  });
}

/**
 * Мерж REST + Export: REST имеет приоритет.
 * Export добавляет только те сделки, которых нет в REST.
 */
export function mergeDeals(restDeals, exportDeals) {
  const merged = new Map();
  for (const d of exportDeals) merged.set(d.ID, d);
  for (const d of restDeals) merged.set(d.ID, d); // REST перезаписывает
  return [...merged.values()];
}
