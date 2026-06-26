import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

// Sub-apps
import testDashboard from '../test-dashboard/server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3000', 10);
const SCRIPTS_DIR = path.join(__dirname, 'scripts');
const CACHE_DIR = path.join(__dirname, 'cache');

await fs.mkdir(CACHE_DIR, { recursive: true }).catch(() => {});

// --- State ---
const dataState = {
  ready: false,
  loading: false,
  error: null,
  loadedAt: null,
};

let aggCache = null;

// --- Load cache ---
async function loadCache() {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(CACHE_DIR, 'agg.json'), 'utf-8'));
    // Add OOM/KOM aliases (agg.json doesn't have oom_* fields)
    raw.oom_ytd = { ...raw.ytd };
    raw.oom_prev = { ...raw.prev };
    raw.oom_cur = { ...raw.cur };
    raw.oom_leads_ytd = raw.leads_ytd;
    raw.kom_leads_ytd = raw.kom_ytd?.won_relevant_cnt || 0;
    aggCache = raw;
    dataState.ready = true;
    dataState.loadedAt = new Date().toISOString();
    console.log(`✓ Cache loaded: ${aggCache.weeks.length} weeks, ${aggCache.ytd.won_relevant_cnt} deals`);
  } catch (e) {
    console.log('Cache not found:', e.message);
  }
}

// --- Refresh: execute Python pipeline ---

function resetLoading() {
  dataState.loading = false;
  dataState.error = 'Сброшено принудительно';
  dataState.startedAt = null;
  dataState.loadingProgress = null;
  dataState.loadingPhase = null;
  console.log('🔄 Loading state reset');
}

function runRefresh() {
  return new Promise((resolve, reject) => {
    if (dataState.loading) return reject(new Error('Already loading'));
    dataState.loading = true;
    dataState.error = null;
    dataState.startedAt = new Date().toISOString();
    dataState.loadingProgress = null;
    dataState.loadingPhase = 'Запуск скрипта...';

    const script = path.join(SCRIPTS_DIR, 'run_full.py');
    const proc = spawn('python3', [script], {
      cwd: SCRIPTS_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    // Парсим stdout в реальном времени для прогресса
    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      
      // Извлекаем прогресс из строк вида:
      // ▶  fetch_deals.py --reset --batches 9999  → фаза
      // [CREATE] batch 0..2450  got=2500  progress=2500/32128 → прогресс
      // ✓  fetch_deals.py — 123.4s → фаза завершена
      // ✅  Полная выгрузка завершена!
      
      const phases = {
        'fetch_refresh': 'Выгрузка сделок (CRM Export API)',
        'fetch_dicts': 'Загрузка справочников',
        'analyze_new': 'Анализ данных (новая логика)',
        'build_xlsx': 'Сборка Excel-отчёта',
      };
      
      // Определяем фазу
      for (const [key, label] of Object.entries(phases)) {
        if (text.includes(`▶  ${key}`) || text.includes(`▶  ${key}.py`)) {
          dataState.loadingPhase = label;
          dataState.loadingProgress = null;
          break;
        }
      }
      
      // Парсим прогресс сделок: progress=2500/32128
      const progMatch = text.match(/progress=([\d]+)\/([\d]+)/);
      if (progMatch) {
        dataState.loadingProgress = {
          current: parseInt(progMatch[1]),
          total: parseInt(progMatch[2])
        };
      }
      
      // Определяем завершение
      if (text.includes('✅  Полная выгрузка завершена')) {
        dataState.loadingPhase = 'Финализация...';
      }
    });
    
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    proc.on('close', async (code) => {
      try {
        if (code !== 0) {
          console.error('Python error:', stderr);
          dataState.error = stderr.substring(0, 500);
          dataState.loading = false;
          dataState.startedAt = null;
          dataState.loadingProgress = null;
          return reject(new Error(`Pipeline exit code ${code}`));
        }

        const raw = JSON.parse(await fs.readFile(path.join(CACHE_DIR, 'agg.json'), 'utf-8'));
        raw.oom_ytd = { ...raw.ytd };
        raw.oom_prev = { ...raw.prev };
        raw.oom_cur = { ...raw.cur };
        raw.oom_leads_ytd = raw.leads_ytd;
        raw.kom_leads_ytd = raw.kom_ytd?.won_relevant_cnt || 0;
        aggCache = raw;
        dataState.ready = true;
        dataState.loadedAt = new Date().toISOString();
        dataState.loading = false;
        dataState.startedAt = null;
        dataState.loadingProgress = null;
        dataState.loadingPhase = null;
        resolve(true);
      } catch (e) {
        dataState.error = e.message;
        dataState.loading = false;
        dataState.startedAt = null;
        dataState.loadingProgress = null;
        dataState.loadingPhase = null;
        reject(e);
      }
    });

    proc.on('error', (e) => {
      dataState.error = e.message;
      dataState.loading = false;
      dataState.startedAt = null;
      dataState.loadingProgress = null;
      dataState.loadingPhase = null;
      reject(e);
    });
  });
}

// --- Express ---
const app = express();
app.set('etag', false); // отключаем ETag, чтобы браузер не кэшировал
app.use(express.json({ limit: '50mb' }));

// Status
app.get('/api/status', (req, res) => res.json(dataState));

// Main data
app.get('/api/data', (req, res) => {
  if (!aggCache) return res.status(503).json({ error: 'Data not loaded' });
  res.json(aggCache);
});

// Refresh
// New logic data endpoint (тот же agg.json, что и /api/data)
app.get('/api/data/new', async (req, res) => {
  const aggNewPath = path.join(CACHE_DIR, 'agg.json');
  try {
    const data = JSON.parse(await fs.readFile(aggNewPath, 'utf-8'));
    data.oom_ytd = { ...data.ytd };
    data.oom_prev = { ...data.prev };
    data.oom_cur = { ...data.cur };
    data.oom_leads_ytd = data.leads_ytd;
    data.kom_leads_ytd = data.kom_ytd?.won_relevant_cnt || 0;
    res.json(data);
  } catch (e) {
    res.status(503).json({ error: 'New logic data not loaded' });
  }
});

app.post('/api/refresh', async (req, res) => {
  if (dataState.loading) return res.json({ ok: false, message: 'Already loading' });
  res.json({ ok: true, message: 'Refresh started' });
  runRefresh().catch(e => console.error('Refresh failed:', e.message));
});

// Force-reset stuck loading state
app.post('/api/refresh/reset', (req, res) => {
  resetLoading();
  res.json({ ok: true, message: 'Loading state reset' });
});

// --- Artifacts: anomalies in payments ---
app.get('/api/artifacts', async (req, res) => {
  try {
    const dealsRaw = await fs.readFile(path.join(CACHE_DIR, 'deals_NEW.json'), 'utf-8').catch(() => '[]');
    const deals = JSON.parse(dealsRaw);
    
    // Есть UF_DATE_PAY_1C
    const withPay = deals.filter(d => d.UF_DATE_PAY_1C);
    
    // Возвраты: LOSE + UF_DATE_PAY_1C + >0
    const returns = withPay
      .filter(d => d.STAGE_SEMANTIC_ID === 'F' && (parseFloat(d.OPPORTUNITY) || 0) > 0)
      .map(d => ({
        id: d.ID,
        title: d.TITLE,
        sum: parseFloat(d.OPPORTUNITY) || 0,
        date: d.UF_DATE_PAY_1C,
        created: d.DATE_CREATE,
        manager: d.ASSIGNED_BY_ID
      }));
    
    // В работе + оплата: P + UF_DATE_PAY_1C + >0
    const inProgressPaid = withPay
      .filter(d => d.STAGE_SEMANTIC_ID === 'P' && (parseFloat(d.OPPORTUNITY) || 0) > 0)
      .map(d => ({
        id: d.ID,
        title: d.TITLE,
        sum: parseFloat(d.OPPORTUNITY) || 0,
        date: d.UF_DATE_PAY_1C,
        created: d.DATE_CREATE,
        manager: d.ASSIGNED_BY_ID
      }));
    
    // WON без UF_DATE_PAY_1C
    const wonNoPay = deals
      .filter(d => d.STAGE_SEMANTIC_ID === 'S' && !d.UF_DATE_PAY_1C && (parseFloat(d.OPPORTUNITY) || 0) > 0);
    
    // Технические: WON + 0
    const tech = deals
      .filter(d => d.STAGE_SEMANTIC_ID === 'S' && (parseFloat(d.OPPORTUNITY) || 0) === 0);
    
    // Отрицательная длительность: UF_DATE_PAY_1C < DATE_CREATE
    const negativeDur = withPay.filter(d => {
      if (!d.DATE_CREATE) return false;
      const pay = new Date(d.UF_DATE_PAY_1C.replace('+03:00','').replace('+00:00','').substring(0,10));
      const create = new Date(d.DATE_CREATE.replace('+03:00','').replace('+00:00','').substring(0,10));
      return !isNaN(pay) && !isNaN(create) && pay < create;
    });
    
    // Сделки на стадии «Следующий год» (UC_W6SCHG) — зависли в воронке
    const nextYear = deals
      .filter(d => {
        const stageId = String(d.STAGE_ID || '');
        return stageId === 'UC_W6SCHG' || stageId.endsWith(':UC_W6SCHG');
      })
      .map(d => ({
        id: d.ID, title: d.TITLE, sum: parseFloat(d.OPPORTUNITY) || 0,
        sem: d.STAGE_SEMANTIC_ID, cat: d.CATEGORY_ID,
        manager: d.ASSIGNED_BY_ID, created: d.DATE_CREATE
      }));
    
    // PreSale сделки, определённые как КОМ (для проверки)
    function isKomDeal(d) {
      const cat = String(d.CATEGORY_ID);
      if (cat === '19') return true;
      if (d.UF_CRM_1683882427069 === 'Y' || d.UF_CRM_1683882427069 === '1') return true;
      if (String(d.UF_FORMAT) === '19042498') return true;
      const dir = d.UF_CRM_1498466811;
      if (dir && (Array.isArray(dir) ? dir.includes('1906') : String(dir) === '1906')) return true;
      if (String(d.UF_CRM_1765896709800) === '34765') return true;
      return false;
    }
    const komInPresale = deals
      .filter(d => String(d.CATEGORY_ID) === '8' && isKomDeal(d) && d.STAGE_SEMANTIC_ID !== 'S')
      .map(d => ({
        id: d.ID, title: d.TITLE, sum: parseFloat(d.OPPORTUNITY) || 0,
        sem: d.STAGE_SEMANTIC_ID, stage: d.STAGE_ID
      }));
    
    // Другие категории с оплатой (не 0, 8, 19) — например Отказы
    const validCats = new Set(['0', '8', '19']);
    const otherCatPaid = withPay
      .filter(d => !validCats.has(String(d.CATEGORY_ID)) && (parseFloat(d.OPPORTUNITY) || 0) > 0)
      .map(d => ({
        id: d.ID, title: d.TITLE, sum: parseFloat(d.OPPORTUNITY) || 0,
        date: d.UF_DATE_PAY_1C, cat: d.CATEGORY_ID,
        sem: d.STAGE_SEMANTIC_ID
      }));
    
    res.json({
      summary: {
        returns: { cnt: returns.length, sum: returns.reduce((a,b) => a + b.sum, 0) },
        inProgressPaid: { cnt: inProgressPaid.length, sum: inProgressPaid.reduce((a,b) => a + b.sum, 0) },
        wonNoPay: { cnt: wonNoPay.length, sum: wonNoPay.reduce((a,b) => a + (parseFloat(b.OPPORTUNITY) || 0), 0) },
        tech: { cnt: tech.length, sum: 0 },
        negativeDuration: { cnt: negativeDur.length, sum: negativeDur.reduce((a,b) => a + (parseFloat(b.OPPORTUNITY) || 0), 0) },
        otherCatPaid: { cnt: otherCatPaid.length, sum: otherCatPaid.reduce((a,b) => a + b.sum, 0) },
        komInPresale: { cnt: komInPresale.length },
        nextYear: { cnt: nextYear.length, sum: nextYear.reduce((a,b) => a + b.sum, 0) }
      },
      details: {
        returns: returns.slice(0, 50),
        inProgressPaid: inProgressPaid.slice(0, 50),
        wonNoPay: wonNoPay.slice(0, 50).map(d => ({
          id: d.ID, title: d.TITLE, sum: parseFloat(d.OPPORTUNITY) || 0,
          created: d.DATE_CREATE, manager: d.ASSIGNED_BY_ID
        })),
        otherCatPaid: otherCatPaid.slice(0, 50),
        komInPresale: komInPresale.slice(0, 50),
        nextYear: nextYear.slice(0, 50)
      }
    });
  } catch (e) {
    console.error('/api/artifacts error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// --- Forecast ---
app.get('/api/forecast', async (req, res) => {
  try {
    const script = path.join(SCRIPTS_DIR, 'forecast.py');
    const proc = spawn('python3', [script], {
      cwd: SCRIPTS_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    await new Promise((resolve, reject) => {
      proc.on('close', (code) => {
        if (code !== 0) return reject(new Error(stderr.substring(0, 500)));
        resolve();
      });
      proc.on('error', reject);
    });
    res.json(JSON.parse(stdout));
  } catch (e) {
    console.error('/api/forecast error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Download Excel
app.get('/api/export', async (req, res) => {
  const xlsxPath = path.join(CACHE_DIR, 'output', 'Отчёт_продажи_2026.xlsx');
  try {
    await fs.access(xlsxPath);
    res.download(xlsxPath, 'Отчёт_продажи_2026.xlsx');
  } catch {
    res.status(404).json({ error: 'Excel file not found. Run refresh first.' });
  }
});

// --- Helper: load participant data & build participants list ---
// Новая логика: проверка по модулям (продуктовым строкам) вместо интервала сделки
async function buildParticipants(weekIndex) {
  if (!aggCache) throw new Error('Data not loaded');

  // Загружаем modules.json (продуктовые строки с датами модулей)
  let modulesData = {};
  try {
    modulesData = JSON.parse(await fs.readFile(path.join(CACHE_DIR, 'modules.json'), 'utf-8'));
  } catch (e) {
    console.log('modules.json not found, skipping module check');
  }

  const [dealsRaw, companiesRaw, contactsRaw, dictsRaw, ccRaw, contExtRaw, formatRaw, compExtRaw] = await Promise.all([
    fs.readFile(path.join(CACHE_DIR, 'deals_2026.json'), 'utf-8').catch(() => '[]'),
    fs.readFile(path.join(CACHE_DIR, 'companies.json'), 'utf-8').catch(() => '{}'),
    fs.readFile(path.join(CACHE_DIR, 'contacts.json'), 'utf-8').catch(() => '{}'),
    fs.readFile(path.join(CACHE_DIR, 'dicts.json'), 'utf-8').catch(() => '{}'),
    fs.readFile(path.join(CACHE_DIR, 'company_contact.json'), 'utf-8').catch(() => '{}'),
    fs.readFile(path.join(CACHE_DIR, 'contacts_ext.json'), 'utf-8').catch(() => '{}'),
    fs.readFile(path.join(CACHE_DIR, 'deals_format.json'), 'utf-8').catch(() => '{}'),
    fs.readFile(path.join(CACHE_DIR, 'companies_ext.json'), 'utf-8').catch(() => '{}'),
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

  const weeks = aggCache.weeks || [];
  const targetWeek = weeks[weekIndex];
  if (!targetWeek) return { participants: [], weekLabel: '—' };

  const wkLabel = targetWeek.label_short + ' (' + targetWeek.label_dates + ')';

  function parseDateRange(datesStr) {
    const parts = datesStr.split('—');
    if (parts.length !== 2) return null;
    const [d1, d2] = parts.map(s => s.trim());
    const [dd1, mm1] = d1.split('.');
    const [dd2, mm2] = d2.split('.');
    const y = 2026;
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
    // Дата в формате YYYY-MM-DD или ISO
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

  // Проверка: пересекается ли модуль с неделей
  function moduleOverlapsWeek(module) {
    const start = parseModuleDate(module.date_start);
    const end = parseModuleDate(module.date_end);
    if (!start || !end) return false;
    return start <= range.end && end >= range.start;
  }

  // Релевантные стадии: WON + Счёт отправлен + Постоплата + Частично оплачен
  const TARGET_STAGES = new Set(['WON', 'PROPOSAL', '2', '6', 'C0:WON', 'C0:PROPOSAL', 'C0:2', 'C0:6']);

  // Фильтруем сделки: категория 0 (ООМ/ОМ), нужные стадии, не КОМ
  const candidateDeals = deals.filter(d => {
    if (String(d.CATEGORY_ID) !== '0') return false;
    if (!TARGET_STAGES.has(d.STAGE_ID)) return false;
    // Фильтр по формату
    const catName = cats[String(d.CATEGORY_ID || '0')];
    const fmt = detectFormat(d.TITLE, catName, d.ID);
    if (fmt !== 'Очно' && fmt !== 'Онлайн') return false;
    // Проверяем сумму: реальные сделки с суммой или учебные
    const opp = parseFloat(d.OPPORTUNITY || 0);
    if (opp > 0) return true;
    return isRealTraining(d.TITLE, d.ID);
  });

  // Строим участников по модулям
  const participants = [];
  const seen = new Set();  // ключ: сдeлка + модуль

  for (const d of candidateDeals) {
    const did = d.ID;
    const dealModules = modulesData[did] || [];

    // Если нет модулей в кэше — пробуем старую логику по датам сделки
    if (dealModules.length === 0) {
      const learnStart = toDate(d.UF_CRM_DATE_START_LEARN);
      const learnEnd = toDate(d.UF_CRM_DATE_END_LEARN);
      if (!learnStart || !learnEnd) continue;
      if (!(learnStart <= range.end && learnEnd >= range.start)) continue;
      // Эмулируем один модуль из дат сделки
      const displayDate = learnStart ? learnStart.toLocaleDateString('ru-RU') : '—';
      dealModules.push({
        product_id: '0',
        original_name: '—',
        date_start: learnStart ? learnStart.toISOString().substring(0, 10) : null,
        date_end: learnEnd ? learnEnd.toISOString().substring(0, 10) : null
      });
    }

    // Фильтруем модули, которые проходят на этой неделе
    const weekModules = dealModules.filter(m => moduleOverlapsWeek(m));
    if (weekModules.length === 0) continue;

    // Данные сделки
    const ccinfo = cc[did] || {};
    const coId = String(ccinfo.COMPANY_ID || d.COMPANY_ID || '0');
    const contactId = String(ccinfo.CONTACT_ID || d.CONTACT_ID || '0');

    const companyName = companies[coId] || '—';
    const contactInfo = contactsExt[contactId] || contacts[contactId] || {};
    const contactName = contactInfo.name || (contactId !== '0' ? `Контакт #${contactId}` : '—');
    const opp = parseFloat(d.OPPORTUNITY || 0);
    const manager = users[String(d.ASSIGNED_BY_ID || '')] || String(d.ASSIGNED_BY_ID || '—');

    // Region: contact → company fallback
    let region = (contactsExt[contactId]?.region || contactsExt[contactId]?.locality || '');
    if (!region && companiesExt[coId]?.region) {
      region = companiesExt[coId].region;
    }

    // Стадия для отображения
    const stageLabel = d.STAGE_ID === 'WON' || d.STAGE_ID === 'C0:WON' ? 'WON'
      : d.STAGE_ID === 'PROPOSAL' || d.STAGE_ID === 'C0:PROPOSAL' ? 'Счёт отправлен'
      : d.STAGE_ID === '2' || d.STAGE_ID === 'C0:2' ? 'Постоплата'
      : d.STAGE_ID === '6' || d.STAGE_ID === 'C0:6' ? 'Частично оплачен'
      : d.STAGE_SEMANTIC_ID === 'S' ? 'WON'
      : d.STAGE_SEMANTIC_ID === 'F' ? 'LOSE' : 'В работе';

    const isPaid = d.STAGE_SEMANTIC_ID === 'S' || d.STAGE_ID === 'WON' || d.STAGE_ID === 'C0:WON';

    for (const mod of weekModules) {
      const key = `${did}_${mod.product_id}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Парсим название модуля из original_name или из названия продуктовой строки
      const moduleName = mod.original_name 
        || (mod.product_name ? mod.product_name.replace(/^Оказание образовательных услуг по теме \"(.+?)\".*$/, '$1').trim() : '—')
        || '—';

      // Дата проведения модуля
      const modStart = parseModuleDate(mod.date_start);
      const modDisplayDate = modStart ? modStart.toLocaleDateString('ru-RU') : '—';

      participants.push({
        id: did,
        title: d.TITLE || '—',
        program: moduleName,
        theme: moduleName,
        participant: contactName,
        company: companyName,
        companyId: coId,
        amount: opp,
        date: modDisplayDate,
        moduleDateStart: mod.date_start,
        moduleDateEnd: mod.date_end,
        manager,
        hadPrevTraining: false,
        prevTrainingDate: '',
        stage: stageLabel,
        isPaid,
        format: detectFormat(d.TITLE, cats[String(d.CATEGORY_ID || '0')], d.ID),
        region
      });
    }
  }

  // Сортировка по дате модуля
  participants.sort((a, b) => {
    if (a.date === '—') return 1;
    if (b.date === '—') return -1;
    return b.date.localeCompare(a.date);
  });

  return { participants, total: participants.length, weekLabel: wkLabel };
}

// --- Participants: ООМ/ОМ deals for previous week ---
app.get('/api/participants', async (req, res) => {
  try {
    const weeks = aggCache?.weeks || [];
    const result = await buildParticipants(weeks.length - 2);
    res.json(result);
  } catch (e) {
    console.error('/api/participants error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// --- Participants: ООМ/ОМ deals for current week ---
app.get('/api/participants/current', async (req, res) => {
  try {
    const weeks = aggCache?.weeks || [];
    const result = await buildParticipants(weeks.length - 1);
    res.json(result);
  } catch (e) {
    console.error('/api/participants/current error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Static files (no-cache for HTML to force refresh)
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// Fallback for drop-dashboard only
app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('ETag', Math.random().toString(36).substring(2));
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

export default app;

// --- Direct start (port mode) ---
const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  await loadCache();
  app.listen(PORT, '0.0.0.0', () => console.log(`🍀 Дроп-дашборд на http://0.0.0.0:${PORT}`));
} else {
  await loadCache();
}
