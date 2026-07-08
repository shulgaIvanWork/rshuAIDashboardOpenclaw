/**
 * fetch-invoices.js — выгрузка статусов счетов (инвойсов) для сделок.
 *
 * ВЫЗЫВАЕТСЯ: из index.js (Шаг 6) во время npm run fetch.
 *   Принимает на вход уже загруженный массив deals.
 *
 * ЗАЧЕМ:
 *   participants-dashboard показывает статус закрытия счёта (стадия инвойса).
 *   Инвойсы — отдельная сущность Bitrix24 (crm.invoice), не дублируется в сделку.
 *
 * РЕЗУЛЬТАТ: cache/invoices.json — { dealId: { invoice_id, status_id, status_name } }
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { writeFileAtomic } from './fs-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DS_CACHE = path.join(__dirname, '..', 'cache');
const WEBHOOK = process.env.BITRIX_BASE;
const MAX_RETRIES = 6;

// Статусы инвойсов Bitrix24
const INVOICE_STATUSES = {};
const STATUS_LOADED = { loaded: false };

async function ensureStatuses() {
  if (STATUS_LOADED.loaded) return;
  STATUS_LOADED.loaded = true;
  try {
    const r = await restCall('crm.status.list', {
      filter: { ENTITY_ID: 'INVOICE_STATUS' },
      select: ['STATUS_ID', 'NAME'],
    });
    for (const s of (r.result || [])) {
      INVOICE_STATUSES[s.STATUS_ID] = s.NAME;
    }
  } catch (e) {
    process.stderr.write(`    WARN загрузка статусов инвойсов: ${e.message}, использую статический справочник\n`);
    // fallback
    Object.assign(INVOICE_STATUSES, {
      N: 'Черновик', S: 'Отправлен клиенту', W: 'Не принят 1С',
      A: 'Принят 1С', J: 'Частично оплачен', L: 'Оплачен',
      P: 'Закрыт успешно', D: 'Отклонён',
    });
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Ретраи с экспоненциальной задержкой — как в bitrix-rest.js
async function restCall(method, params = {}) {
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
        process.stderr.write(`    Retry ${attempt + 1}/${MAX_RETRIES - 1}: ${e.message} (wait ${wait / 1000}s)\n`);
        await sleep(wait);
      } else {
        throw e;
      }
    }
  }
}

export async function fetchInvoices(deals) {
  process.stdout.write('  Загрузка статусов инвойсов...\n');

  await ensureStatuses();
  process.stdout.write(`    Статусов инвойсов: ${Object.keys(INVOICE_STATUSES).length}\n`);

  // Собираем ID подходящих сделок (категория 0, не КОМ)
  const dealIds = deals
    .filter(d => String(d.CATEGORY_ID) === '0')
    .map(d => d.ID)
    .filter(Boolean);

  process.stdout.write(`    Сделок категории 0: ${dealIds.length}\n`);

  const result = {};
  const BATCH_SIZE = 50;

  for (let i = 0; i < dealIds.length; i += BATCH_SIZE) {
    const chunk = dealIds.slice(i, i + BATCH_SIZE);
    const batchCmd = {};
    chunk.forEach((did, j) => {
      batchCmd[`i${j}`] =
        `crm.invoice.list?filter[UF_DEAL_ID]=${did}&select[]=ID&select[]=STATUS_ID&select[]=UF_DEAL_ID&order[DATE_INSERT]=DESC&limit=1`;
    });
    const cmd = { cmd: batchCmd, halt: 0 };

    try {
      const r = await restCall('batch', cmd);
      const results = r.result?.result || {};
      for (let j = 0; j < chunk.length; j++) {
        const key = `i${j}`;
        const invArr = results[key] || [];
        if (invArr.length > 0) {
          const inv = invArr[0]; // последний счёт (order DESC)
          const did = String(inv.UF_DEAL_ID || chunk[j]);
          result[did] = {
            invoice_id: inv.ID,
            status_id: inv.STATUS_ID,
            status_name: INVOICE_STATUSES[inv.STATUS_ID] || inv.STATUS_ID,
          };
        }
      }
    } catch (e) {
      process.stderr.write(`    WARN инвойсы batch ${i}: ${e.message}\n`);
    }

    if (i > 0 && i % 1000 === 0) {
      process.stdout.write(`    ...обработано ${Math.min(i, dealIds.length)}/${dealIds.length}\n`);
    }
    await sleep(50);
  }

  process.stdout.write(`    Найдено инвойсов: ${Object.keys(result).length}\n`);

  // Сохраняем (атомарно, чтобы дашборды не прочитали полузаписанный файл)
  const outPath = path.join(DS_CACHE, 'invoices.json');
  await writeFileAtomic(outPath, JSON.stringify(result, null, 2));
  process.stdout.write(`    → cache/invoices.json\n`);

  return result;
}
