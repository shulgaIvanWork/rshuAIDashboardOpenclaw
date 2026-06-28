/**
 * Выгрузка контактов и компаний из Bitrix24 по ID из сделок.
 * Используется participants-dashboard для отображения имён участников.
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
  const res = await fetch(WEBHOOK + method + '.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  return res.json();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function batchGet(ids, buildCmd, extractFn) {
  const result = {};
  const unique = [...new Set(ids.map(String).filter(id => id && id !== '0'))];

  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    const cmd = { halt: '0' };
    chunk.forEach((id, j) => { cmd[`cmd[i${j}]`] = buildCmd(id); });
    try {
      const r = await restCall('batch', cmd);
      const res = r.result?.result || {};
      chunk.forEach((id, j) => {
        const item = res[`i${j}`];
        if (item) result[id] = extractFn(item);
      });
    } catch (e) {
      process.stderr.write(`  WARN batch error: ${e.message}\n`);
    }
    if (i + 50 < unique.length) await sleep(500);
  }
  return result;
}

export async function fetchContacts(deals) {
  const ids = deals
    .map(d => String(d.CONTACT_ID || '0'))
    .filter(id => id && id !== '0');

  process.stdout.write(`  Контакты: ${[...new Set(ids)].length} уникальных ID...\n`);

  const contacts = await batchGet(
    ids,
    id => `crm.contact.get?id=${id}&select[]=NAME&select[]=LAST_NAME&select[]=SECOND_NAME&select[]=POST&select[]=ADDRESS_CITY&select[]=ADDRESS_REGION`,
    item => ({
      name: [item.NAME, item.LAST_NAME].filter(Boolean).join(' ') || `Контакт #${item.ID}`,
      post: item.POST || '',
      region: item.ADDRESS_CITY || item.ADDRESS_REGION || '',
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
