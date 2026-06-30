/**
 * bitrix-rest.js — выгрузка сделок через Bitrix24 REST API.
 *
 * ВЫЗЫВАЕТСЯ: из index.js (Шаг 1) во время npm run fetch.
 *
 * ЧТО ДЕЛАЕТ:
 *   Запрашивает crm.deal.list через вебхук BITRIX_BASE (.env).
 *   Листает все страницы через `next`-токен пагинации.
 *   При обрыве соединения делает до 6 повторных попыток с экспоненциальной задержкой.
 *
 * ВОЗВРАЩАЕТ: массив сделок из воронок CATEGORIES=[0,8,19], начиная с YEAR_START.
 *
 * ПОЛЯ СДЕЛОК (SELECT):
 *   Стандартные: ID, TITLE, STAGE_ID, STAGE_SEMANTIC_ID, CATEGORY_ID, OPPORTUNITY,
 *                DATE_CREATE, CLOSEDATE, CLOSED, ASSIGNED_BY_ID, SOURCE_ID,
 *                COMPANY_ID, CONTACT_ID
 *   Кастомные UF-поля:
 *     UF_DATE_PAY_1C          — дата оплаты (из 1С)
 *     UF_FORMAT               — формат обучения (онлайн/очно/КОМ/...)
 *     UF_CRM_1498466811       — направление (MBA, Mini MBA, ...)
 *     UF_CRM_1683882427069    — флаг КОМ-сделки
 *     UF_CRM_1765896709800    — тип обучения (ПК/ПП/КО)
 *     UF_CRM_1753272713011    — дата выставления счёта (INV_DT)
 *     UF_CRM_DATE_START_LEARN — дата начала обучения (уровень сделки)
 *     UF_CRM_DATE_END_LEARN   — дата конца обучения (уровень сделки)
 *
 * ОГРАНИЧЕНИЕ: только сделки начиная с 2025-01-01 и воронок 0, 8, 19.
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
  'UF_CRM_1697096074',
  'UF_CRM_1744273716729',
  'UF_CRM_1474975772',
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
