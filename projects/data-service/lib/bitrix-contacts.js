/**
 * bitrix-contacts.js — выгрузка контактов и компаний по ID из сделок.
 *
 * ВЫЗЫВАЕТСЯ: из index.js (Шаг 4) во время npm run fetch.
 *   Принимает на вход уже загруженный массив deals.
 *
 * ЗАЧЕМ:
 *   analyze.js не хранит имена контактов и компаний — только их ID.
 *   participants-dashboard нужно показывать реальные имена участников (кто учится)
 *   и названия компаний. Этот модуль выгружает их отдельно через REST API.
 *
 * ЧТО ВЫГРУЖАЕТ:
 *   contacts.json — { contactId → { name, post, region } }
 *     Поля: NAME + LAST_NAME (ФИО), POST (должность), ADDRESS_CITY/REGION (город)
 *     Источник: crm.contact.get через batch-запросы по 50 штук
 *
 *   companies.json — { companyId → "Название компании" }
 *     Источник: crm.company.get через batch-запросы по 50 штук
 *
 * ИСПОЛЬЗУЕТСЯ: participants-dashboard/server.js для отображения таблицы участников.
 *   kom-dashboard/server.js также читает companies.json для топ-компаний.
 *
 * ПРОИЗВОДИТЕЛЬНОСТЬ: ~20 000 контактов → ~400 batch-запросов → ~7 минут.
 *   Каждый запрос имеет таймаут 15 сек, при зависании выводит WARN и продолжает.
 */

const WEBHOOK = process.env.BITRIX_BASE;

function flattenParams(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => out.push([`${key}[${i}]`, item]));
    } else if (v && typeof v === 'object') {
      out.push(...flattenParams(v, key));
    } else {
      out.push([key, v]);
    }
  }
  return out;
}

async function restCall(method, params = {}) {
  const body = new URLSearchParams(flattenParams(params)).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(WEBHOOK + method + '.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    });
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function batchGet(ids, buildCmd, extractFn) {
  const result = {};
  const unique = [...new Set(ids.map(String).filter(id => id && id !== '0'))];

  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    const cmd = { halt: '0' };
    chunk.forEach((id, j) => { cmd[`cmd[i${j}]`] = buildCmd(id); });
    process.stdout.write(`  [${i + chunk.length}/${unique.length}] запрос...\r`);
    try {
      const r = await restCall('batch', cmd);
      const res = r.result?.result || {};
      chunk.forEach((id, j) => {
        const item = res[`i${j}`];
        if (item) result[id] = extractFn(item);
      });
    } catch (e) {
      process.stderr.write(`\n  WARN batch error at ${i}: ${e.message}\n`);
    }
    if (i + 50 < unique.length) await sleep(300);
  }
  process.stdout.write('\n');
  return result;
}

export async function fetchContacts(deals) {
  const ids = deals
    .map(d => String(d.CONTACT_ID || '0'))
    .filter(id => id && id !== '0');

  process.stdout.write(`  Контакты: ${[...new Set(ids)].length} уникальных ID...\n`);

  const contacts = await batchGet(
    ids,
    id => `crm.contact.get?id=${id}&select[]=NAME&select[]=LAST_NAME&select[]=SECOND_NAME&select[]=POST&select[]=ADDRESS_CITY&select[]=ADDRESS_REGION&select[]=UF_CRM_1448611987`,
    item => ({
      name: [item.LAST_NAME, item.NAME, item.SECOND_NAME].filter(Boolean).join(' ') || `Контакт #${item.ID}`,
      post: item.POST || '',
      region: item.ADDRESS_CITY || item.ADDRESS_REGION || '',
      cityOfResidence: item.UF_CRM_1448611987 || '',  // «Город проживания» — полный адрес
    })
  );

  process.stdout.write(`  Получено: ${Object.keys(contacts).length} контактов\n`);
  return contacts;
}

export async function fetchCompanies(deals) {
  const ids = deals
    .map(d => String(d.COMPANY_ID || '0'))
    .filter(id => id && id !== '0');

  process.stdout.write(`  Компании: ${[...new Set(ids)].length} уникальных ID...\n`);

  const companies = await batchGet(
    ids,
    id => `crm.company.get?id=${id}&select[]=TITLE`,
    item => item.TITLE || '—'
  );

  process.stdout.write(`  Получено: ${Object.keys(companies).length} компаний\n`);
  return companies;
}
