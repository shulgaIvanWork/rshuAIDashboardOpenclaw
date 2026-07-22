/**
 * plan-fact-dashboard — «План-факт выручки» (автоматизация ручной Google-таблицы
 * «Выручка ОМ. План-факт»). Все ФАКТЫ считаются из кэша Bitrix24 (data-service),
 * как в rshu-management-dashboard — ручное заполнение не требуется.
 *
 * 4 отчёта (повторяют листы таблицы):
 *   weekly — «2026»: понедельно, направление × формат: выручка, участники, дни
 *   post   — «Пост/Выр/Уч»: тематики × каналы (ООМ/ОнОМ/СДО/КОМ):
 *            поступления / участники / выручка
 *   om     — «Выручка_ОМ»: тематики × месяцы (только открытое обучение ООМ+ОнОМ)
 *   sdo    — «Выручка_СДО»: тематики × годы (только СДО), суммы и участники
 *
 * ПРАВИЛА (допущения, согласовать при необходимости):
 *   Поступления — по дате оплаты UF_DATE_PAY_1C.
 *   Выручка     — по дате обучения (первый модуль из modules.json, иначе
 *                 UF_CRM_DATE_START_LEARN, иначе дата оплаты).
 *   Каналы: КОМ = isKomDeal; иначе формат: Очный/MMBA/Вечерний/ГК → ООМ,
 *           Видеокурс → СДО, остальное → ОнОМ.
 */
import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  UF, YEAR, isKomDeal, isPaidDeal, getOpp, detectFormat,
} from '@rshu/data-service/lib/deal-rules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3000', 10);
const DS_CACHE = path.join(__dirname, '..', '..', 'data-service', 'cache');
const MODULES_PATH = path.join(__dirname, '..', 'participants-dashboard', 'cache', 'modules.json');

const CACHE_TTL_MS = 5 * 60 * 1000;

// ── ISO-недели (как в participants-dashboard) ────────────────────────────────
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
function isoWeeksInYear(year) { return isoWeekOf(new Date(year, 11, 28))[1]; }
const fmt2 = n => String(n).padStart(2, '0');
function weekDatesLabel(week) {
  const s = fromISOCalendar(YEAR, week, 1), e = fromISOCalendar(YEAR, week, 7);
  return `${fmt2(s.getDate())}.${fmt2(s.getMonth() + 1)}—${fmt2(e.getDate())}.${fmt2(e.getMonth() + 1)}`;
}

const MONTH_NAMES = ['Январь','Февраль','Март','Апрель','Май','Июнь',
  'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

// ── Классификация сделок ─────────────────────────────────────────────────────
const CHANNELS = ['ООМ', 'ОнОМ', 'СДО', 'КОМ'];

function channelOf(d) {
  if (isKomDeal(d)) return 'КОМ';
  const f = detectFormat(d.TITLE, d[UF.FORMAT]);
  if (f === 'Видеокурс') return 'СДО';
  if (f === 'Очный' || f === 'MMBA' || f === 'Вечерний' || f === 'ГК') return 'ООМ';
  return 'ОнОМ';
}

function parseDt(s) {
  if (!s) return null;
  const d = new Date(String(s).substring(0, 10) + 'T00:00:00');
  return isNaN(d.getTime()) ? null : d;
}

// Дата обучения для признания выручки: первый модуль → UF-даты сделки → дата оплаты
function trainStart(d, modules) {
  const mods = modules[d.ID] || [];
  let min = null;
  for (const m of mods) {
    if (m.date_start && (!min || m.date_start < min)) min = m.date_start;
  }
  if (min) return parseDt(min);
  return parseDt(d[UF.LEARN_START]) || parseDt(d[UF.PAY_DATE_1C]);
}

// ── Расчёт всех отчётов ──────────────────────────────────────────────────────
// (export — для сверочных скриптов)
export async function compute() {
  const [dealsRaw, dictsRaw, modsRaw, fetchedRaw] = await Promise.all([
    fs.readFile(path.join(DS_CACHE, 'deals.json'), 'utf-8'),
    fs.readFile(path.join(DS_CACHE, 'dicts.json'), 'utf-8').catch(() => '{}'),
    fs.readFile(MODULES_PATH, 'utf-8').catch(() => '{}'),
    fs.readFile(path.join(DS_CACHE, 'fetched_at.json'), 'utf-8').catch(() => '{}'),
  ]);
  const deals = JSON.parse(dealsRaw);
  const dicts = JSON.parse(dictsRaw);
  const modules = JSON.parse(modsRaw);
  const fetchedAt = (JSON.parse(fetchedRaw) || {}).fetchedAt || null;
  const directions = dicts.directions || {};

  // Объединения тематик — как в эталонной таблице сотрудницы
  const DIR_MERGE = {
    'Школа продаж': 'Продажи и коммерция',
    'Строительство и девелопмент': 'Строительство',
  };
  function dirName(d) {
    const raw = d[UF.DIRECTION];
    const arr = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    let name = arr.length ? (directions[String(arr[0])] || '—').trim() : '—';
    name = DIR_MERGE[name] || name;
    // Mini-MBA в Б24 не выделен направлением — только в названии сделки
    if (name === 'MBA' && /mini|мини/i.test(d.TITLE || '')) name = 'Mini-MBA';
    return name;
  }

  // ── post: Пост/Выр/Уч — тематики × каналы, за YEAR и предыдущий год ────────
  const POST_YEARS = [YEAR, YEAR - 1];
  const postByYear = {}; // year → dir → { post:{ch}, part:{ch}, rev:{ch} }
  for (const y of POST_YEARS) postByYear[y] = {};
  function postRow(y, dir) {
    const map = postByYear[y];
    if (!map[dir]) {
      map[dir] = { post: {}, part: {}, rev: {} };
      for (const ch of CHANNELS) { map[dir].post[ch] = 0; map[dir].part[ch] = 0; map[dir].rev[ch] = 0; }
    }
    return map[dir];
  }

  // ── om: тематики × месяцы (ООМ+ОнОМ, выручка по дате обучения) ─────────────
  const omMap = {}; // dir → number[12]

  // ── sdo: тематики × годы (СДО, по дате оплаты) ─────────────────────────────
  const SDO_YEARS = [YEAR, YEAR - 1, YEAR - 2];
  const sdoMap = {}; // dir → { sums:{y}, counts:{y} }

  for (const d of deals) {
    if (!isPaidDeal(d)) continue;
    const opp = getOpp(d);
    const payDt = parseDt(d[UF.PAY_DATE_1C]);
    if (!payDt) continue;
    const ch = channelOf(d);
    const dir = dirName(d);

    // Поступления и участники — по дате оплаты
    const payYear = payDt.getFullYear();
    if (POST_YEARS.includes(payYear)) {
      const row = postRow(payYear, dir);
      row.post[ch] += opp;
      row.part[ch] += 1;
    }

    // Выручка — по дате обучения
    const tDt = trainStart(d, modules);
    if (tDt && POST_YEARS.includes(tDt.getFullYear())) {
      postRow(tDt.getFullYear(), dir).rev[ch] += opp;
      if (tDt.getFullYear() === YEAR && (ch === 'ООМ' || ch === 'ОнОМ')) {
        if (!omMap[dir]) omMap[dir] = new Array(12).fill(0);
        omMap[dir][tDt.getMonth()] += opp;
      }
    }

    // СДО по годам оплаты
    if (ch === 'СДО' && SDO_YEARS.includes(payDt.getFullYear())) {
      if (!sdoMap[dir]) {
        sdoMap[dir] = { sums: {}, counts: {} };
        for (const y of SDO_YEARS) { sdoMap[dir].sums[y] = 0; sdoMap[dir].counts[y] = 0; }
      }
      sdoMap[dir].sums[payDt.getFullYear()] += opp;
      sdoMap[dir].counts[payDt.getFullYear()] += 1;
    }
  }

  const postRowsByYear = {};
  for (const y of POST_YEARS) {
    postRowsByYear[y] = Object.entries(postByYear[y])
      .map(([direction, v]) => ({ direction, ...v }))
      .sort((a, b) => (CHANNELS.reduce((s, c) => s + b.post[c], 0)) - (CHANNELS.reduce((s, c) => s + a.post[c], 0)));
  }

  const omRows = Object.entries(omMap)
    .map(([direction, byMonth]) => ({ direction, byMonth, total: byMonth.reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.total - a.total);

  const sdoRows = Object.entries(sdoMap)
    .map(([direction, v]) => ({ direction, ...v }))
    .sort((a, b) => b.sums[YEAR] - a.sums[YEAR]);

  // ── weekly: «2026» — неделя × направление × формат (только ОМ) ─────────────
  // ЛОГИКА КАК В PARTICIPANTS-DASHBOARD:
  //   человек учится только во время модуля — к неделе относим по пересечению
  //   модуля с неделей; «дни» — уникальные даты модулей этой недели;
  //   факт выручки недели = сумма сделки / всего модулей × модулей на неделе;
  //   участником считается сделка с галочкой «Участник» (UF_CRM_1477555902).
  const TARGET_STAGES = new Set(['WON', 'PROPOSAL', '2', '6', 'C0:WON', 'C0:PROPOSAL', 'C0:2', 'C0:6']);
  const totalWeeks = isoWeeksInYear(YEAR);
  const weekAgg = {}; // week → key(dir|fmt) → agg

  // Формат «Очно»/«Онлайн» — как в participants-dashboard (по UF_FORMAT и названию)
  function detectFmtOm(d) {
    const ufFmt = String(d[UF.FORMAT] || '');
    if (ufFmt === '19042467') return 'очно';
    if (ufFmt === '19042468') return 'онлайн';
    if (ufFmt === '19042498') return null; // КОМ
    const t = (d.TITLE || '').toLowerCase();
    if (/(сдо)/.test(t) || t.endsWith('сдо') || / сдо /.test(t)) return null; // СДО
    if (/онлайн/.test(t) || /дистанц/.test(t)) return 'онлайн';
    const cityMarkers = ['в г.', 'москв', 'тюмен', 'санкт-петербург', 'екатеринбург',
      'новосиб', 'казан', 'краснодар', 'владивосток', 'хабаровск', 'самар', 'перм'];
    for (const m of cityMarkers) {
      if (t.includes(m)) return 'очно';
    }
    return 'онлайн';
  }

  function isRealTraining(d) {
    const t = (d.TITLE || '').toLowerCase();
    const skipWords = ['копия для статистики', 'входящий звонок', 'запрос программы',
      'запрос каталога', 'запрос на прораба', 'уход со страницы', 'получите консультацию',
      'лид-магнит', 'обратный звонок', 'тест-драйв'];
    for (const w of skipWords) {
      if (t.includes(w)) return false;
    }
    const realFormats = ['19042467', '19042468', '19042495'];
    if (realFormats.includes(String(d[UF.FORMAT] || ''))) return true;
    if (t.length < 10 && (t.startsWith('запрос') || t === 'промо')) return false;
    return true;
  }

  function isParticipantFlag(d) {
    const v = d[UF.PARTICIPANT_FLAG];
    return v === true || v === '1' || v === 1;
  }

  for (const d of deals) {
    if (String(d.CATEGORY_ID) !== '0') continue;
    if (isKomDeal(d)) continue;
    if (!TARGET_STAGES.has(d.STAGE_ID)) continue;
    const fmt = detectFmtOm(d);
    if (!fmt) continue;
    const opp = getOpp(d);
    if (!(opp > 0) && !isRealTraining(d)) continue;
    const dir = dirName(d);
    const paid = isPaidDeal(d);
    const isPart = isParticipantFlag(d);

    let mods = modules[d.ID] || [];
    if (mods.length === 0) {
      const ls = parseDt(d[UF.LEARN_START]), le = parseDt(d[UF.LEARN_END]);
      if (!ls || !le) continue;
      mods = [{ date_start: ls.toISOString().substring(0, 10), date_end: le.toISOString().substring(0, 10) }];
    }
    // По каждой неделе YEAR: сколько модулей её пересекает и их даты.
    // Знаменатель пропорции — суммарное число пересечений «модуль × неделя»
    // (для коротких модулей = кол-во модулей, т.е. ровно «сумма / модулей всего
    // × модулей на неделе»; длинный модуль на несколько недель делится между ними,
    // а не даёт полную сумму в каждую).
    const dealWeeks = new Map(); // week → { modCount, dates:Set }
    let totalSlots = 0;
    for (const m of mods) {
      const ms = parseDt(m.date_start), me = parseDt(m.date_end);
      if (!ms || !me) continue;
      const touched = new Set();
      for (let t = new Date(ms); t <= me; t.setDate(t.getDate() + 1)) {
        const [wy, w] = isoWeekOf(t);
        touched.add(wy + '-' + w);
        if (wy === YEAR) {
          if (!dealWeeks.has(w)) dealWeeks.set(w, { modCount: 0, dates: new Set(), _seen: new Set() });
          const dw = dealWeeks.get(w);
          if (!dw._seen.has(m)) {
            dw._seen.add(m);
            dw.modCount += 1;
            if (m.date_start) dw.dates.add(m.date_start);
            if (m.date_end) dw.dates.add(m.date_end);
          }
        }
      }
      totalSlots += touched.size;
    }
    if (totalSlots === 0) continue;

    for (const [w, dw] of dealWeeks) {
      if (!weekAgg[w]) weekAgg[w] = {};
      // Одна строка на направление; очно+онлайн объединяются («очно/онлайн»),
      // как в Google-таблице
      if (!weekAgg[w][dir]) {
        weekAgg[w][dir] = { direction: dir, formats: new Set(), revenue: 0, participants: 0, uchOch: 0, uchOnl: 0, days: new Set() };
      }
      const a = weekAgg[w][dir];
      a.formats.add(fmt);
      // Выручка недели — доля суммы сделки по модулям этой недели
      if (paid) a.revenue += opp * dw.modCount / totalSlots;
      if (isPart) {
        a.participants += 1;
        if (fmt === 'очно') a.uchOch += 1; else a.uchOnl += 1;
      }
      for (const day of dw.dates) a.days.add(day);
    }
  }

  const weekly = [];
  for (let w = 1; w <= totalWeeks; w++) {
    const groups = weekAgg[w];
    if (!groups) continue;
    const rows = Object.values(groups).map(a => ({
      direction: a.direction,
      format: a.formats.size > 1 ? 'очно/онлайн' : (Array.from(a.formats)[0] || '—'),
      revenue: Math.round(a.revenue),
      participants: a.participants, uchOch: a.uchOch, uchOnl: a.uchOnl, days: a.days.size,
    })).sort((a, b) => b.revenue - a.revenue);
    const total = rows.reduce((t, r) => ({
      revenue: t.revenue + r.revenue, participants: t.participants + r.participants,
      uchOch: t.uchOch + r.uchOch, uchOnl: t.uchOnl + r.uchOnl, days: Math.max(t.days, r.days),
    }), { revenue: 0, participants: 0, uchOch: 0, uchOnl: 0, days: 0 });
    const monStart = fromISOCalendar(YEAR, w, 1);
    weekly.push({ week: w, dates: weekDatesLabel(w), month: MONTH_NAMES[monStart.getMonth()], rows, total });
  }

  return {
    computedAt: new Date().toISOString(),
    fetchedAt, year: YEAR, channels: CHANNELS,
    weekly,
    post: { years: POST_YEARS, byYear: postRowsByYear },
    om: { months: MONTH_NAMES, rows: omRows },
    sdo: { years: SDO_YEARS, rows: sdoRows },
  };
}

let cache = null, cacheAt = 0, computing = null;
async function getData() {
  if (cache && Date.now() - cacheAt < CACHE_TTL_MS) return cache;
  if (computing) return computing;
  computing = compute().then(r => {
    cache = r; cacheAt = Date.now(); computing = null; return r;
  }).catch(e => {
    computing = null;
    if (cache) { console.warn('[plan-fact] compute failed, stale cache:', e.message); return cache; }
    throw e;
  });
  return computing;
}

const app = express();
app.set('etag', false);

app.get('/api/data', async (req, res) => {
  try {
    res.json(await getData());
  } catch (e) {
    console.error('/api/data error:', e.message);
    res.status(503).json({ error: e.message });
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

app.get(/(.*)/, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

export default app;

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  app.listen(PORT, '0.0.0.0', () => console.log(`📋 План-факт на http://0.0.0.0:${PORT}`));
}
