/**
 * Выгрузка сделок через Bitrix24 REST API crm.deal.list
 * Пагинация через `next`-токен, retry при обрывах соединения.
 */

const WEBHOOK = process.env.BITRIX_BASE;

const SELECT = [
  'ID', 'TITLE', 'STAGE_ID', 'STAGE_SEMANTIC_ID', 'CATEGORY_ID',
  'OPPORTUNITY', 'CURRENCY_ID', 'DATE_CREATE', 'DATE_MODIFY',
  'CLOSEDATE', 'CLOSED', 'ASSIGNED_BY_ID', 'SOURCE_ID',
  'COMPANY_ID', 'CONTACT_ID',
  'UF_DATE_PAY_1C',
  'UF_FORMAT',
  'UF_CRM_1498466811',
  'UF_CRM_1683882427069',
  'UF_CRM_1765896709800',
  'UF_CRM_1753272713011',
  'UF_CRM_1753341391806',
  'UF_CRM_DATE_START_LEARN',
  'UF_CRM_DATE_END_LEARN',
];

const CATEGORIES = [0, 8, 19];
const YEAR_START = '2025-01-01';
const DELAY_MS = 1000;
const MAX_RETRIES = 6;

async function restCall(method, params) {
  const url = WEBHOOK + method + '.json';
  const body = JSON.stringify(params);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      return await res.json();
    } catch (e) {
      if (attempt < MAX_RETRIES - 1) {
        const wait = 10000 * (attempt + 1);
        process.stderr.write(`  Retry ${attempt + 1}/${MAX_RETRIES - 1}: ${e.message} (wait ${wait / 1000}s)\n`);
        await new Promise(r => setTimeout(r, wait));
      } else {
        throw e;
      }
    }
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export async function fetchDealsRest(onProgress) {
  const deals = new Map();
  let start = 0;
  let page = 0;

  while (true) {
    const params = {
      order: { ID: 'ASC' },
      filter: {
        '>=DATE_CREATE': YEAR_START,
        '=CATEGORY_ID': CATEGORIES,
      },
      select: SELECT,
      start,
    };

    const resp = await restCall('crm.deal.list', params);
    const items = resp.result || [];
    if (!items.length) break;

    for (const d of items) deals.set(d.ID, d);

    page++;
    if (onProgress) onProgress(deals.size);

    if (resp.next == null) break;
    start = resp.next;
    await sleep(DELAY_MS);
  }

  return [...deals.values()];
}
