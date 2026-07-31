/**
 * participants-dashboard/server.js — дашборд «Участники» (sub-app оболочки).
 *
 * ЗАЧЕМ:
 *   Пофамильный список участников обучения по выбранной НЕДЕЛЕ: кто, программа/
 *   модуль, компания, регион, статус сделки и счёта, суммы, цикл сделки,
 *   предыдущее обучение участника/компании.
 *
 * ЧТО ДЕЛАЕТ (API):
 *   GET /api/weeks         — недели года + текущая (для селектора);
 *   GET /api/participants  — участники за неделю (ядро: buildParticipants());
 *   GET /api/data,/data/new— YTD-агрегаты из getAgg() (метаданные/шапка);
 *   GET /api/export        — выгрузка недели в Excel (lib/export-excel.js);
 *   catch-all — index.html только на путях БЕЗ расширения (см. README).
 *
 * ИСТОЧНИКИ: getAgg() (сделки/справочники) + cache/modules.json (даты модулей).
 *   Неделя = ISO-неделя; участник в неделе, если её пересекает модуль программы.
 */

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

// ── ISO-недели: диапазон дат по номеру недели отчётного года ─────────────────
// Позволяет выбирать любую неделю (прошлую или будущую), не завися от agg.weeks,
// где есть только недели с начала года по текущую.
function fromISOCalendar(year, week, dow) {
  const jan4 = new Date(year, 0, 4);
  const jan4dow = jan4.getDay() || 7;
  const d = new Date(jan4);
  d.setDate(jan4.getDate() - jan4dow + 1 + (week - 1) * 7 + dow - 1);
  return d;
}

function isoWeekOf(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = d.getDay() || 7;
  const thu = new Date(d); thu.setDate(d.getDate() + 4 - dow);
  const yr = thu.getFullYear();
  const week = Math.floor((thu - new Date(yr, 0, 1)) / (7 * 86400000)) + 1;
  return [yr, week];
}

// 28 декабря всегда попадает в последнюю ISO-неделю года (52 или 53)
function isoWeeksInYear(year) {
  return isoWeekOf(new Date(year, 11, 28))[1];
}

function currentWeekNum() {
  const [yr, w] = isoWeekOf(new Date());
  if (yr === YEAR) return w;
  return yr > YEAR ? isoWeeksInYear(YEAR) : 1;
}

const fmt2 = n => String(n).padStart(2, '0');

function weekRange(week) {
  const start = fromISOCalendar(YEAR, week, 1);
  const end = fromISOCalendar(YEAR, week, 7);
  end.setHours(23, 59, 59);
  return { start, end };
}

function weekDatesLabel(week) {
  const { start, end } = weekRange(week);
  return `${fmt2(start.getDate())}.${fmt2(start.getMonth() + 1)}—${fmt2(end.getDate())}.${fmt2(end.getMonth() + 1)}`;
}

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

// Build participants list for a given ISO week number of YEAR
async function buildParticipants(weekNum) {
  let modulesData = {};
  try {
    modulesData = JSON.parse(await fs.readFile(path.join(PARTS_CACHE, 'modules.json'), 'utf-8'));
  } catch {
    console.log('modules.json not found, skipping module check');
  }

  const [dealsRaw, companiesRaw, contactsRaw, dictsRaw, ccRaw, contExtRaw, formatRaw, compExtRaw, invoicesRaw] = await Promise.all([
    fs.readFile(path.join(DS_CACHE, 'deals.json'), 'utf-8').catch(() => '[]'),
    fs.readFile(path.join(DS_CACHE, 'companies.json'), 'utf-8').catch(() => '{}'),
    fs.readFile(path.join(DS_CACHE, 'contacts.json'), 'utf-8').catch(() => '{}'),
    fs.readFile(path.join(DS_CACHE, 'dicts.json'), 'utf-8').catch(() => '{}'),
    fs.readFile(path.join(PARTS_CACHE, 'company_contact.json'), 'utf-8').catch(() => '{}'),
    fs.readFile(path.join(PARTS_CACHE, 'contacts_ext.json'), 'utf-8').catch(() => '{}'),
    fs.readFile(path.join(PARTS_CACHE, 'deals_format.json'), 'utf-8').catch(() => '{}'),
    fs.readFile(path.join(PARTS_CACHE, 'companies_ext.json'), 'utf-8').catch(() => '{}'),
    fs.readFile(path.join(DS_CACHE, 'invoices.json'), 'utf-8').catch(() => '{}'),
  ]);

  const deals = JSON.parse(dealsRaw);
  const companies = JSON.parse(companiesRaw);
  const contacts = JSON.parse(contactsRaw);
  const dicts = JSON.parse(dictsRaw);
  const cc = JSON.parse(ccRaw);
  const contactsExt = JSON.parse(contExtRaw);
  const dealsFormat = JSON.parse(formatRaw);
  const companiesExt = JSON.parse(compExtRaw);
  const invoices = JSON.parse(invoicesRaw);

  const cats = dicts.categories || {};
  const users = dicts.users || {};
  const directions = dicts.directions || {};

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

  const wkLabel = `W${fmt2(weekNum)} (${weekDatesLabel(weekNum)})`;
  const range = weekRange(weekNum);

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
    if (isKomDeal(d)) return false;
    if (!TARGET_STAGES.has(d.STAGE_ID)) return false;
    const catName = cats[String(d.CATEGORY_ID || '0')];
    const fmt = detectFormat(d.TITLE, catName, d.ID);
    if (fmt !== 'Очно' && fmt !== 'Онлайн') return false;
    const opp = parseFloat(d.OPPORTUNITY || 0);
    if (opp > 0) return true;
    return isRealTraining(d.TITLE, d.ID);
  });

  // Оплаченные обучения по контактам («Пред. обучение») и по компаниям
  // («Последнее обучение от компании») — один проход, условия одинаковые
  const contactTrainingDeals = new Map();
  const companyTrainingDeals = new Map();
  for (const d of deals) {
    if (String(d.CATEGORY_ID) !== '0') continue;
    if (isKomDeal(d)) continue;
    if (!isPaidDeal(d)) continue;
    const ccinfo2 = cc[d.ID] || {};
    const entry = { id: d.ID, payDate: d.UF_DATE_PAY_1C.substring(0, 10) };
    const cid = String(ccinfo2.CONTACT_ID || d.CONTACT_ID || '0');
    if (cid !== '0') {
      if (!contactTrainingDeals.has(cid)) contactTrainingDeals.set(cid, []);
      contactTrainingDeals.get(cid).push(entry);
    }
    const coid = String(ccinfo2.COMPANY_ID || d.COMPANY_ID || '0');
    if (coid !== '0') {
      if (!companyTrainingDeals.has(coid)) companyTrainingDeals.set(coid, []);
      companyTrainingDeals.get(coid).push(entry);
    }
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

    // ═══ Регион: только из UF_CRM_1448611987 (Город проживания) ═══
    // Поле содержит «Город, Область, Страна» — извлекаем только область.
    // Если поле пустое — оставляем пустым, чтобы видеть, что менеджер не заполнил.
    function extractRegion(field) {
      if (!field || field.trim() === '') return '';
      const parts = field.split(',').map(s => s.trim()).filter(Boolean);
      if (parts.length >= 3) return parts[1];  // «Хабаровск, Хабаровский край, Россия» → «Хабаровский край»
      if (parts.length === 2) {
        const knownCountries = ['россия','рф','казахстан','беларусь','украина','иран','узбекистан','таджикистан','киргизия','армения','азербайджан','молдова','грузия','латвия','литва','эстония','польша','германия','франция','италия','испания','сша','китай','индия','израиль','турция','оаэ','объединенные арабские эмираты','египет','финляндия'];
        if (knownCountries.includes(parts[1].toLowerCase().trim())) return parts[0];
        return parts[1];
      }
      return parts[0];  // просто город
    }

    let region = extractRegion(contactInfo.cityOfResidence) || '';

    const stageLabel = d.STAGE_ID === 'WON' || d.STAGE_ID === 'C0:WON' ? 'Счёт оплачен'
      : d.STAGE_ID === 'PROPOSAL' || d.STAGE_ID === 'C0:PROPOSAL' ? 'Счёт отправлен'
      : d.STAGE_ID === '2' || d.STAGE_ID === 'C0:2' ? 'Постоплата'
      : d.STAGE_ID === '6' || d.STAGE_ID === 'C0:6' ? 'Частично оплачен'
      : d.STAGE_SEMANTIC_ID === 'S' ? 'Счёт оплачен'
      : d.STAGE_SEMANTIC_ID === 'F' ? 'LOSE' : 'В работе';

    const isPaid = d.STAGE_SEMANTIC_ID === 'S' || d.STAGE_ID === 'WON' || d.STAGE_ID === 'C0:WON';

    // ── Направление из сделки (UF_CRM_1498466811) ─────────────────────────
    const dirRaw = d.UF_CRM_1498466811;
    let dirName = '—';
    if (dirRaw && Array.isArray(dirRaw) && dirRaw.length > 0) {
      dirName = directions[String(dirRaw[0])] || '—';
    }

    // ── Тип клиента: компания или физик ────────────────────────────────────
    const clientType = (coId && coId !== '0') ? 'B2B' : 'B2C';

    // ── Цикл сделки: DATE_CREATE → UF_DATE_PAY_1C ──────────────────────────
    let dealCycle = null;
    if (d.DATE_CREATE && d.UF_DATE_PAY_1C) {
      const created = new Date(d.DATE_CREATE.substring(0, 10));
      const paid    = new Date(d.UF_DATE_PAY_1C.substring(0, 10));
      const diff = Math.round((paid - created) / 86400000);
      if (diff >= 0) dealCycle = diff;
    }

    // ── Группируем модули недели по product_id ─────────────────────────────
    const groups = {};
    for (const mod of weekModules) {
      const pid = mod.product_id || '0';
      if (!groups[pid]) groups[pid] = [];
      groups[pid].push(mod);
    }

    for (const [pid, mods] of Object.entries(groups)) {
      const key = `${did}_${pid}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Название программы (из товара, без дат и оригинальных названий модулей)
      const firstMod = mods[0];
      const rawName = firstMod.product_name
        ? firstMod.product_name.replace(/^Оказание образовательных услуг по теме "(.+?)".*$/, '$1').trim()
        : null;
      const programName = rawName ? normalizeTitle(rawName) : '—';

      // Агрегированные даты: мин date_start, макс date_end, кол-во уникальных дней
      const allDates = new Set();
      let minStart = null, maxEnd = null;
      for (const m of mods) {
        if (m.date_start) {
          allDates.add(m.date_start);
          if (!minStart || m.date_start < minStart) minStart = m.date_start;
        }
        if (m.date_end) {
          allDates.add(m.date_end);
          if (!maxEnd || m.date_end > maxEnd) maxEnd = m.date_end;
        }
      }

      const displayDateStart = minStart
        ? new Date(minStart + 'T00:00:00').toLocaleDateString('ru-RU')
        : '—';
      const displayDateEnd = maxEnd
        ? new Date(maxEnd + 'T00:00:00').toLocaleDateString('ru-RU')
        : '—';
      const trainingDays = allDates.size;

      participants.push({
        id: did,
        title: d.TITLE || '—',
        direction: dirName,
        program: programName,
        participant: contactName,
        company: companyName,
        companyId: coId,
        clientType,
        amount: opp,
        date: displayDateStart,
        dateEnd: displayDateEnd,
        moduleDuration: trainingDays,
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
        lastCompanyTraining: (() => {
          if (coId === '0') return '';
          const history = companyTrainingDeals.get(coId) || [];
          const others = history.filter(t => t.id !== did).map(t => t.payDate).sort();
          return others.length ? others[others.length - 1] : '';
        })(),
        stage: stageLabel,
        isPaid,
        format: detectFormat(d.TITLE, cats[String(d.CATEGORY_ID || '0')], d.ID),
        region,
        // Новые поля
        participantFlag: (() => {
          const v = d.UF_CRM_1477555902;
          if (v === true || v === '1' || v === 1) return 'Да';
          if (v === false || v === '0' || v === 0) return 'Нет';
          return '';
        })(),
        invoiceDiscount: (() => {
          const v = d.UF_DISCOUNT;
          return (v && parseFloat(v) > 0) ? parseFloat(v) : null;
        })(),
        invoiceStatus: (() => {
          const inv = invoices[d.ID];
          return inv ? inv.status_name || inv.status_id : '';
        })(),
      });
    }
  }

  participants.sort((a, b) => {
    if (a.date === '—') return 1;
    if (b.date === '—') return -1;
    return b.date.localeCompare(a.date);
  });

  // Разбивка по направлениям — сколько участников в каждом
  const byDirection = {};
  for (const p of participants) {
    const key = p.direction || '—';
    byDirection[key] = (byDirection[key] || 0) + 1;
  }
  const directionCounts = Object.entries(byDirection)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  return { participants, total: participants.length, week: weekNum, weekLabel: wkLabel, directionCounts };
}

// Список всех ISO-недель отчётного года для селектора + номер текущей
app.get('/api/weeks', (req, res) => {
  const total = isoWeeksInYear(YEAR);
  const current = currentWeekNum();
  const weeks = [];
  for (let w = 1; w <= total; w++) {
    weeks.push({ week: w, dates: weekDatesLabel(w) });
  }
  res.json({ weeks, current });
});

// ?week=N — номер ISO-недели; без параметра — текущая неделя
app.get('/api/participants', async (req, res) => {
  try {
    const total = isoWeeksInYear(YEAR);
    let week = parseInt(req.query.week, 10);
    if (!week || week < 1 || week > total) week = currentWeekNum();
    const result = await buildParticipants(week);
    res.json(result);
  } catch (e) {
    console.error('/api/participants error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/participants/current', async (req, res) => {
  try {
    const result = await buildParticipants(currentWeekNum());
    res.json(result);
  } catch (e) {
    console.error('/api/participants/current error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/export', async (req, res) => {
  try {
    const total = isoWeeksInYear(YEAR);
    let week = parseInt(req.query.week, 10);
    if (!week || week < 1 || week > total) week = currentWeekNum();
    const result = await buildParticipants(week);
    const { buildParticipantsWorkbook } = await import('./lib/export-excel.js');
    const buffer = await buildParticipantsWorkbook(result);
    const fileName = `participants_W${String(week).padStart(2, '0')}_${new Date().toISOString().substring(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(Buffer.from(buffer));
  } catch (e) {
    console.error('/api/export error:', e.message);
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
  if (path.extname(req.path)) return res.status(404).end();
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
