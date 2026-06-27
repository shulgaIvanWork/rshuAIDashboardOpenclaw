/**
 * Выгрузка справочников Bitrix24 (REST + Export API):
 * воронки, стадии, источники, пользователи, форматы, направления, UF-поля
 */

const WEBHOOK = process.env.BITRIX_BASE;
const EXPORT_URL = 'https://24.uprav.ru/web_services/crm/export.php';
const SECRET = '14b0fc053c141e47a5974b3859f5753f';

// --- REST helpers ---

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

// --- Export API helper ---

async function exportCall(action, data = []) {
  const params = [
    ['secret', SECRET],
    ['action', action],
    ...data,
  ];
  const body = new URLSearchParams(params).toString();
  const res = await fetch(EXPORT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  return res.json();
}

// --- Справочники ---

async function fetchCategories() {
  const r = await restCall('crm.dealcategory.list', { select: ['ID', 'NAME'] });
  const cats = { '0': 'Общая (по умолчанию)' };
  for (const c of (r.result || [])) cats[String(c.ID)] = c.NAME;
  return cats;
}

async function fetchStages(catIds) {
  const stages = {};
  for (const catId of catIds) {
    try {
      const r = await restCall('crm.dealcategory.stage.list', { id: Number(catId) });
      for (const s of (r.result || [])) stages[s.STATUS_ID] = s.NAME || s.STATUS_ID;
    } catch (e) {
      process.stderr.write(`  WARN stage cid=${catId}: ${e.message}\n`);
    }
  }
  return stages;
}

async function fetchSources() {
  const r = await restCall('crm.status.list', { filter: { ENTITY_ID: 'SOURCE' } });
  const map = {};
  for (const s of (r.result || [])) map[s.STATUS_ID] = s.NAME;
  return map;
}

async function fetchUsers(deals) {
  const uids = [...new Set(deals.map(d => d.ASSIGNED_BY_ID).filter(Boolean))].sort();
  const users = {};

  for (let i = 0; i < uids.length; i += 50) {
    const chunk = uids.slice(i, i + 50);
    const cmd = Object.fromEntries(chunk.map((uid, j) => [`cmd[u${j}]`, `user.get?ID=${uid}`]));
    cmd['halt'] = '0';
    try {
      const r = await restCall('batch', cmd);
      const res = r.result?.result || {};
      for (let j = 0; j < chunk.length; j++) {
        const arr = res[`u${j}`] || [];
        if (arr[0]) {
          const u = arr[0];
          users[String(chunk[j])] = [u.NAME, u.LAST_NAME].filter(Boolean).join(' ') || u.EMAIL || `ID ${chunk[j]}`;
        }
      }
    } catch (e) {
      process.stderr.write(`  WARN users batch: ${e.message}\n`);
    }
  }
  return users;
}

async function fetchFormats() {
  const r = await exportCall('getFormats');
  if (!r.success) return {};
  const map = {};
  for (const f of (r.data?.items || [])) map[String(f.ID)] = f.NAME;
  return map;
}

async function fetchDirections() {
  const r = await exportCall('getDirections');
  if (!r.success) return {};
  const items = r.data?.items || {};
  // items — объект { "id": { ID, VALUE, SORT } }
  const map = {};
  for (const [id, v] of Object.entries(items)) map[String(id)] = v.VALUE || v.ID;
  return map;
}

async function fetchUserFields() {
  const r = await exportCall('getUserFieldsCrm');
  if (!r.success) return {};
  return r.data?.items || {};
}

// --- Основная функция ---

export async function fetchDicts(deals) {
  process.stdout.write('  Воронки...\n');
  const categories = await fetchCategories();
  process.stdout.write(`    ${Object.keys(categories).length} воронок\n`);

  process.stdout.write('  Стадии...\n');
  const stages = await fetchStages(Object.keys(categories));
  process.stdout.write(`    ${Object.keys(stages).length} стадий\n`);

  process.stdout.write('  Источники...\n');
  const sources = await fetchSources();
  process.stdout.write(`    ${Object.keys(sources).length} источников\n`);

  process.stdout.write('  Пользователи...\n');
  const users = await fetchUsers(deals);
  process.stdout.write(`    ${Object.keys(users).length} пользователей\n`);

  process.stdout.write('  Форматы (Export API)...\n');
  const formats = await fetchFormats();
  process.stdout.write(`    ${Object.keys(formats).length} форматов\n`);

  process.stdout.write('  Направления (Export API)...\n');
  const directions = await fetchDirections();
  process.stdout.write(`    ${Object.keys(directions).length} направлений\n`);

  process.stdout.write('  UF-поля CRM (Export API)...\n');
  const userFields = await fetchUserFields();
  process.stdout.write(`    ${Object.keys(userFields).length} полей\n`);

  return { categories, stages, sources, users, formats, directions, userFields };
}
