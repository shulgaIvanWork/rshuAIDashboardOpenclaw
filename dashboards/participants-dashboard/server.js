import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAgg, getCacheAt } from '@rshu/data-service/agg-cache.js';
// Единые бизнес-правила: КОМ-признак, «настоящая оплата», отчётный год
import { isKomDeal, isPaidDeal, YEAR } from '@rshu/data-service/lib/deal-rules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3000', 10);
// Participants-specific cache (modules, contacts, companies — not in data-service)
const PARTS_CACHE = path.join(__dirname, 'cache');
const DS_CACHE = path.join(__dirname, '..', '..', 'data-service', 'cache');
const DEALS_PATH = path.join(DS_CACHE, 'deals.json');

const app = express();
app.set('etag', false);
app.use(express.json({ limit: '50mb' }));

app.get('/api/user', (req, res) => {
  res.json({ role: (req.user && req.user.role) || 'guest' });
});

app.get('/api/data', async (req, res) => {
  try {
    const data = await getAgg();
    res.json(Object.assign({}, data, { _loadedAt: data.fetched_at || new Date(getCacheAt()).toISOString() }));
  } catch (e) {
    console.error('/api/data error:', e.message);
    res.status(503).json({ error: e.message });
  }
});

// Alias for legacy frontend calls
app.get('/api/data/new', async (req, res) => {
  try {
    const data = await getAgg();
    res.json(Object.assign({}, data, { _loadedAt: data.fetched_at || new Date(getCacheAt()).toISOString() }));
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
});

app.get('/api/artifacts', async (req, res) => {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  try {
    const deals = JSON.parse(await fs.readFile(DEALS_PATH, 'utf-8'));
    const withPay = deals.filter(d => d.UF_DATE_PAY_1C);

    const returns = withPay
      .filter(d => d.STAGE_SEMANTIC_ID === 'F' && (parseFloat(d.OPPORTUNITY) || 0) > 0)
      .map(d => ({ id: d.ID, title: d.TITLE, sum: parseFloat(d.OPPORTUNITY) || 0, date: d.UF_DATE_PAY_1C, created: d.DATE_CREATE, manager: d.ASSIGNED_BY_ID }));

    const inProgressPaid = withPay
      .filter(d => d.STAGE_SEMANTIC_ID === 'P' && (parseFloat(d.OPPORTUNITY) || 0) > 0)
      .map(d => ({ id: d.ID, title: d.TITLE, sum: parseFloat(d.OPPORTUNITY) || 0, date: d.UF_DATE_PAY_1C, created: d.DATE_CREATE, manager: d.ASSIGNED_BY_ID }));

    const wonNoPay = deals
      .filter(d => d.STAGE_SEMANTIC_ID === 'S' && !d.UF_DATE_PAY_1C && (parseFloat(d.OPPORTUNITY) || 0) > 0);

    const negativeDur = withPay.filter(d => {
      if (!d.DATE_CREATE) return false;
      const pay = new Date(d.UF_DATE_PAY_1C.substring(0, 10));
      const create = new Date(d.DATE_CREATE.substring(0, 10));
      return !isNaN(pay) && !isNaN(create) && pay < create;
    });

    const nextYear = deals
      .filter(d => { const s = String(d.STAGE_ID || ''); return s === 'UC_W6SCHG' || s.endsWith(':UC_W6SCHG'); })
      .map(d => ({ id: d.ID, title: d.TITLE, sum: parseFloat(d.OPPORTUNITY) || 0, sem: d.STAGE_SEMANTIC_ID, cat: d.CATEGORY_ID, manager: d.ASSIGNED_BY_ID, created: d.DATE_CREATE }));

    const validCats = new Set(['0', '8', '19']);
    const otherCatPaid = withPay
      .filter(d => !validCats.has(String(d.CATEGORY_ID)) && (parseFloat(d.OPPORTUNITY) || 0) > 0)
      .map(d => ({ id: d.ID, title: d.TITLE, sum: parseFloat(d.OPPORTUNITY) || 0, date: d.UF_DATE_PAY_1C, cat: d.CATEGORY_ID, sem: d.STAGE_SEMANTIC_ID }));

    const komInPresale = deals
      .filter(d => String(d.CATEGORY_ID) === '8' && isKomDeal(d) && d.STAGE_SEMANTIC_ID !== 'S')
      .map(d => ({ id: d.ID, title: d.TITLE, sum: parseFloat(d.OPPORTUNITY) || 0, sem: d.STAGE_SEMANTIC_ID, stage: d.STAGE_ID }));

    const sum = arr => arr.reduce((a, b) => a + (b.sum || 0), 0);
    res.json({
      summary: {
        returns:          { cnt: returns.length,        sum: sum(returns) },
        inProgressPaid:   { cnt: inProgressPaid.length, sum: sum(inProgressPaid) },
        wonNoPay:         { cnt: wonNoPay.length,       sum: wonNoPay.reduce((a, b) => a + (parseFloat(b.OPPORTUNITY) || 0), 0) },
        negativeDuration: { cnt: negativeDur.length,    sum: negativeDur.reduce((a, b) => a + (parseFloat(b.OPPORTUNITY) || 0), 0) },
        otherCatPaid:     { cnt: otherCatPaid.length,   sum: sum(otherCatPaid) },
        komInPresale:     { cnt: komInPresale.length },
        nextYear:         { cnt: nextYear.length,       sum: sum(nextYear) },
      },
      details: {
        returns: returns.slice(0, 50),
        inProgressPaid: inProgressPaid.slice(0, 50),
        wonNoPay: wonNoPay.slice(0, 50).map(d => ({ id: d.ID, title: d.TITLE, sum: parseFloat(d.OPPORTUNITY) || 0, created: d.DATE_CREATE, manager: d.ASSIGNED_BY_ID })),
        otherCatPaid: otherCatPaid.slice(0, 50),
        komInPresale: komInPresale.slice(0, 50),
        nextYear: nextYear.slice(0, 50),
      }
    });
  } catch (e) {
    console.error('/api/artifacts error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Strip dates, cities, contract numbers from deal title to get program name
function normalizeTitle(title) {
  return (title || '')
    .replace(/\s*Договор\s*№.*$/i, '')
    .replace(/\s*\d{1,2}[./]\d{1,2}[./]?\d{0,4}[-–—]\d{1,2}[./]\d{1,2}[./]?\d{0,4}/g, '')
    .replace(/\s*\d{1,2}[./]\d{1,2}[./]?\d{0,4}/g, '')
    .replace(/\s+в\s+г\.?\s*[А-ЯЁA-Z][а-яёa-z\-]+/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[ .,:;"«»()\-–—]+|[ .,:;"«»()\-–—]+$/g, '')
    || title;
}

// Build participants list for a given week index
async function buildParticipants(weekIndex) {
  const agg = await getAgg();

  let modulesData = {};
  try {
    modulesData = JSON.parse(await fs.readFile(path.join(PARTS_CACHE, 'modules.json'), 'utf-8'));
  } catch {
    console.log('modules.json not found, skipping module check');
  }

  const [dealsRaw, companiesRaw, contactsRaw, dictsRaw, ccRaw, contExtRaw, formatRaw, compExtRaw] = await Promise.all([
    fs.readFile(path.join(DS_CACHE, 'deals.json'), 'utf-8').catch(() => '[]'),
    fs.readFile(path.join(DS_CACHE, 'companies.json'), 'utf-8').catch(() => '{}'),
    fs.readFile(path.join(DS_CACHE, 'contacts.json'), 'utf-8').catch(() => '{}'),
    fs.readFile(path.join(DS_CACHE, 'dicts.json'), 'utf-8').catch(() => '{}'),
    fs.readFile(path.join(PARTS_CACHE, 'company_contact.json'), 'utf-8').catch(() => '{}'),
    fs.readFile(path.join(PARTS_CACHE, 'contacts_ext.json'), 'utf-8').catch(() => '{}'),
    fs.readFile(path.join(PARTS_CACHE, 'deals_format.json'), 'utf-8').catch(() => '{}'),
    fs.readFile(path.join(PARTS_CACHE, 'companies_ext.json'), 'utf-8').catch(() => '{}'),
  ]);

  const deals = JSON.parse(dealsRaw);
  const companies = JSON.parse(companiesRaw);
  const contacts = JSON.parse(contactsRaw);
  const dicts = JSON.parse(dictsRaw);
  const cc = JSON.parse(ccRaw);
  const contactsExt = JSON.parse(contExtRaw);
  const dealsFormat = JSON.parse(formatRaw);
  const companiesExt = JSON.parse(compExtRaw);

  const cats = dicts.categories || {};
  const users = dicts.users || {};

  const KOM_CATS = ['КОМ (Sale)', 'КОМ (Post Sale)'];

  function detectFormat(title, catName, dealId) {
    const ufFmt = dealId && dealsFormat ? dealsFormat[dealId] : null;
    if (ufFmt === '19042468' || ufFmt === '19042467') return ufFmt === '19042467' ? 'Очно' : 'Онлайн';
    if (ufFmt === '19042498') return 'КОМ';
    if (KOM_CATS.includes(catName)) return 'КОМ';
    const t = (title || '').toLowerCase();
    if (/(сдо)/.test(t) || t.endsWith('сдо') || / сдо /.test(t)) return 'СДО';
    if (/онлайн/.test(t) || /дистанц/.test(t)) return 'Онлайн';
    const cityMarkers = ['в г.', 'москв', 'тюмен', 'санкт-петербург', 'екатеринбург',
      'новосиб', 'казан', 'краснодар', 'владивосток', 'хабаровск', 'самар', 'перм'];
    for (const m of cityMarkers) {
      if (t.includes(m)) return 'Очно';
    }
    return 'Онлайн';
  }

  const weeks = agg.weeks || [];
  const targetWeek = weeks[weekIndex];
  if (!targetWeek) return { participants: [], weekLabel: '—' };

  const wkLabel = targetWeek.label_short + ' (' + targetWeek.label_dates + ')';

  function parseDateRange(datesStr) {
    const parts = datesStr.split('—');
    if (parts.length !== 2) return null;
    const [d1, d2] = parts.map(s => s.trim());
    const [dd1, mm1] = d1.split('.');
    const [dd2, mm2] = d2.split('.');
    const y = YEAR;
    const m1 = parseInt(mm1), d1n = parseInt(dd1);
    const m2 = parseInt(mm2), d2n = parseInt(dd2);
    const start = new Date(y, m1 - 1, d1n);
    const end = new Date(y, m2 - 1, d2n, 23, 59, 59);
    return { start, end };
  }

  const range = parseDateRange(targetWeek.label_dates);
  if (!range) return { participants: [], weekLabel: wkLabel };

  function toDate(s) {
    if (!s) return null;
    const d = new Date(s.replace('+03:00', '').replace('+00:00', '').substring(0, 19));
    return isNaN(d.getTime()) ? null : d;
  }

  function parseModuleDate(s) {
    if (!s) return null;
    const d = new Date(s.substring(0, 10) + 'T00:00:00');
    return isNaN(d.getTime()) ? null : d;
  }

  function isRealTraining(title, dealId) {
    const t = (title || '').toLowerCase();
    const skipWords = ['копия для статистики', 'входящий звонок', 'запрос программы',
      'запрос каталога', 'запрос на прораба', 'уход со страницы', 'получите консультацию',
      'лид-магнит', 'обратный звонок', 'тест-драйв'];
    for (const w of skipWords) {
      if (t.includes(w)) return false;
    }
    const realFormats = ['19042467', '19042468', '19042495'];
    if (dealId && dealsFormat && realFormats.includes(dealsFormat[dealId])) return true;
    if (t.length < 10 && (t.startsWith('запрос') || t === 'промо')) return false;
    return true;
  }

  function moduleOverlapsWeek(module) {
    const start = parseModuleDate(module.date_start);
    const end = parseModuleDate(module.date_end);
    if (!start || !end) return false;
    return start <= range.end && end >= range.start;
  }

  const TARGET_STAGES = new Set(['WON', 'PROPOSAL', '2', '6', 'C0:WON', 'C0:PROPOSAL', 'C0:2', 'C0:6']);

  const candidateDeals = deals.filter(d => {
    if (String(d.CATEGORY_ID) !== '0') return false;
    if (!TARGET_STAGES.has(d.STAGE_ID)) return false;
    const catName = cats[String(d.CATEGORY_ID || '0')];
    const fmt = detectFormat(d.TITLE, catName, d.ID);
    if (fmt !== 'Очно' && fmt !== 'Онлайн') return false;
    const opp = parseFloat(d.OPPORTUNITY || 0);
    if (opp > 0) return true;
    return isRealTraining(d.TITLE, d.ID);
  });

  // Build map: contactId → qualifying paid deals (sale funnel, реальная оплата по правилам deal-rules)
  const contactTrainingDeals = new Map();
  for (const d of deals) {
    if (String(d.CATEGORY_ID) !== '0') continue;
    if (!isPaidDeal(d)) continue;
    const ccinfo2 = cc[d.ID] || {};
    const cid = String(ccinfo2.CONTACT_ID || d.CONTACT_ID || '0');
    if (cid === '0') continue;
    if (!contactTrainingDeals.has(cid)) contactTrainingDeals.set(cid, []);
    contactTrainingDeals.get(cid).push({ id: d.ID, payDate: d.UF_DATE_PAY_1C.substring(0, 10) });
  }

  const participants = [];
  const seen = new Set();

  for (const d of candidateDeals) {
    const did = d.ID;
    const dealModules = modulesData[did] || [];

    if (dealModules.length === 0) {
      const learnStart = toDate(d.UF_CRM_DATE_START_LEARN);
      const learnEnd = toDate(d.UF_CRM_DATE_END_LEARN);
      if (!learnStart || !learnEnd) continue;
      if (!(learnStart <= range.end && learnEnd >= range.start)) continue;
      dealModules.push({
        product_id: '0',
        original_name: null,
        product_name: d.TITLE,   // use deal title as program fallback
        date_start: learnStart ? learnStart.toISOString().substring(0, 10) : null,
        date_end: learnEnd ? learnEnd.toISOString().substring(0, 10) : null
      });
    }

    const weekModules = dealModules.filter(m => moduleOverlapsWeek(m));
    if (weekModules.length === 0) continue;

    const ccinfo = cc[did] || {};
    const coId = String(ccinfo.COMPANY_ID || d.COMPANY_ID || '0');
    const contactId = String(ccinfo.CONTACT_ID || d.CONTACT_ID || '0');

    const companyName = companies[coId] || '—';
    const contactInfo = contacts[contactId] || contactsExt[contactId] || {};
    const contactName = contactInfo.name || (contactId !== '0' ? `Контакт #${contactId}` : '—');
    const opp = parseFloat(d.OPPORTUNITY || 0);
    const manager = users[String(d.ASSIGNED_BY_ID || '')] || String(d.ASSIGNED_BY_ID || '—');

    let region = contactInfo.region || contactsExt[contactId]?.region || contactsExt[contactId]?.locality || '';
    if (!region && companiesExt[coId]?.region) {
      region = companiesExt[coId].region;
    }

    const stageLabel = d.STAGE_ID === 'WON' || d.STAGE_ID === 'C0:WON' ? 'Счёт оплачен'
      : d.STAGE_ID === 'PROPOSAL' || d.STAGE_ID === 'C0:PROPOSAL' ? 'Счёт отправлен'
      : d.STAGE_ID === '2' || d.STAGE_ID === 'C0:2' ? 'Постоплата'
      : d.STAGE_ID === '6' || d.STAGE_ID === 'C0:6' ? 'Частично оплачен'
      : d.STAGE_SEMANTIC_ID === 'S' ? 'Счёт оплачен'
      : d.STAGE_SEMANTIC_ID === 'F' ? 'LOSE' : 'В работе';

    const isPaid = d.STAGE_SEMANTIC_ID === 'S' || d.STAGE_ID === 'WON' || d.STAGE_ID === 'C0:WON';

    for (const mod of weekModules) {
      const key = `${did}_${mod.product_id}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const rawName = mod.original_name
        || (mod.product_name ? mod.product_name.replace(/^Оказание образовательных услуг по теме "(.+?)".*$/, '$1').trim() : null);
      const moduleName = rawName ? normalizeTitle(rawName) : '—';

      const modStart = parseModuleDate(mod.date_start);
      const modEnd   = parseModuleDate(mod.date_end);
      const modDisplayDate    = modStart ? modStart.toLocaleDateString('ru-RU') : '—';
      const modDisplayDateEnd = modEnd   ? modEnd.toLocaleDateString('ru-RU')   : '—';

      // Длительность модуля в днях
      let moduleDuration = null;
      if (modStart && modEnd) {
        moduleDuration = Math.round((modEnd - modStart) / 86400000) + 1;
      }

      // Тип клиента: компания или физик
      const clientType = (coId && coId !== '0') ? 'B2B' : 'B2C';

      // Цикл сделки: DATE_CREATE → UF_DATE_PAY_1C
      let dealCycle = null;
      if (d.DATE_CREATE && d.UF_DATE_PAY_1C) {
        const created = new Date(d.DATE_CREATE.substring(0, 10));
        const paid    = new Date(d.UF_DATE_PAY_1C.substring(0, 10));
        const diff = Math.round((paid - created) / 86400000);
        if (diff >= 0) dealCycle = diff;
      }

      participants.push({
        id: did,
        title: d.TITLE || '—',
        program: moduleName,
        theme: moduleName,
        participant: contactName,
        company: companyName,
        companyId: coId,
        clientType,
        amount: opp,
        date: modDisplayDate,
        dateEnd: modDisplayDateEnd,
        moduleDuration,
        moduleDateStart: mod.date_start,
        moduleDateEnd: mod.date_end,
        manager,
        dealCycle,
        hadPrevTraining: (() => {
          const history = contactTrainingDeals.get(contactId) || [];
          return history.some(t => t.id !== did);
        })(),
        prevTrainingDate: (() => {
          const history = contactTrainingDeals.get(contactId) || [];
          const others = history.filter(t => t.id !== did).map(t => t.payDate).sort();
          return others.length ? others[others.length - 1] : '';
        })(),
        stage: stageLabel,
        isPaid,
        format: detectFormat(d.TITLE, cats[String(d.CATEGORY_ID || '0')], d.ID),
        region
      });
    }
  }

  participants.sort((a, b) => {
    if (a.date === '—') return 1;
    if (b.date === '—') return -1;
    return b.date.localeCompare(a.date);
  });

  return { participants, total: participants.length, weekLabel: wkLabel };
}

app.get('/api/participants', async (req, res) => {
  try {
    const agg = await getAgg();
    const weeks = agg.weeks || [];
    const result = await buildParticipants(weeks.length - 2);
    res.json(result);
  } catch (e) {
    console.error('/api/participants error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/participants/current', async (req, res) => {
  try {
    const agg = await getAgg();
    const weeks = agg.weeks || [];
    const result = await buildParticipants(weeks.length - 1);
    res.json(result);
  } catch (e) {
    console.error('/api/participants/current error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

app.get(/(.*)/,  (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

export default app;

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  app.listen(PORT, '0.0.0.0', () => console.log(`🍀 Участники на http://0.0.0.0:${PORT}`));
}
