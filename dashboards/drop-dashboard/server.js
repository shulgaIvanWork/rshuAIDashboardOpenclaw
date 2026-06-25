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
    aggCache = JSON.parse(await fs.readFile(path.join(CACHE_DIR, 'agg.json'), 'utf-8'));
    dataState.ready = true;
    dataState.loadedAt = new Date().toISOString();
    console.log(`✓ Cache loaded: ${aggCache.weeks.length} weeks`);
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
        'fetch_deals': 'Выгрузка сделок из Bitrix24',
        'fetch_leads': 'Выгрузка лидов',
        'merge': 'Объединение данных',
        'fetch_dicts': 'Загрузка справочников',
        'analyze': 'Анализ данных',
        'build_html': 'Сборка HTML-отчёта',
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

        aggCache = JSON.parse(await fs.readFile(path.join(CACHE_DIR, 'agg.json'), 'utf-8'));
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
app.use(express.json({ limit: '50mb' }));

// Status
app.get('/api/status', (req, res) => res.json(dataState));

// User info
app.get('/api/user', (req, res) => {
  res.json({ role: (req.user && req.user.role) || 'guest' });
});

// Main data
app.get('/api/data', (req, res) => {
  if (!aggCache) return res.status(503).json({ error: 'Data not loaded' });
  res.json(aggCache);
});

// Refresh
// New logic data endpoint
app.get('/api/data/new', async (req, res) => {
  const aggNewPath = path.join(CACHE_DIR, 'agg_new.json');
  try {
    const data = JSON.parse(await fs.readFile(aggNewPath, 'utf-8'));
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
async function buildParticipants(weekIndex) {
  if (!aggCache) throw new Error('Data not loaded');

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
    if (ufFmt === '19042468') return 'ОМ (Онлайн)';
    if (ufFmt === '19042498') return 'КОМ';
    if (KOM_CATS.includes(catName)) return 'КОМ';
    const t = (title || '').toLowerCase();
    if (/(сдо)/.test(t) || t.endsWith('сдо') || / сдо /.test(t)) return 'СДО';
    if (/онлайн/.test(t) || /дистанц/.test(t)) return 'ОМ (Онлайн)';
    const cityMarkers = ['в г.', 'москв', 'тюмен', 'санкт-петербург', 'екатеринбург',
      'новосиб', 'казан', 'краснодар', 'владивосток', 'хабаровск', 'самар', 'перм'];
    for (const m of cityMarkers) {
      if (t.includes(m)) return 'ООМ (Очное)';
    }
    return 'ОМ (Онлайн)';
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

  // Дата начала и окончания обучения (приоритет: товар → сделка → CLOSEDATE)
  function getLearnPeriod(d) {
    let start = toDate(d.UF_CRM_DATE_START_LEARN);
    let end = toDate(d.UF_CRM_DATE_END_LEARN);
    // Fallback на CLOSEDATE, если дат обучения нет
    if (!start && !end) {
      const cd = toDate(d.CLOSEDATE);
      if (cd) {
        start = cd;
        end = cd;
      }
    }
    return { start, end };
  }

  // Проверка: пересекается ли период обучения с неделей
  function learnOverlapsWeek(d) {
    const p = getLearnPeriod(d);
    if (!p.start || !p.end) return false;
    return p.start <= range.end && p.end >= range.start;
  }

  // Find ООМ/ОМ сделки — WON, у которых обучение пересекается с неделей
  const OOM_OM_DEALS = deals.filter(d => {
    const catName = cats[String(d.CATEGORY_ID || '0')];
    const fmt = detectFormat(d.TITLE, catName, d.ID);
    if (fmt !== 'ООМ (Очное)' && fmt !== 'ОМ (Онлайн)') return false;
    if (d.STAGE_SEMANTIC_ID !== 'S') return false;
    if (d.CLOSED !== 'Y') return false;
    if (!learnOverlapsWeek(d)) return false;
    const opp = parseFloat(d.OPPORTUNITY || 0);
    if (opp > 0) return true;
    return isRealTraining(d.TITLE, d.ID);
  });

  // Build company history
  const companyHistory = {};
  for (const d of deals) {
    const catName = cats[String(d.CATEGORY_ID || '0')];
    const fmt = detectFormat(d.TITLE, catName, d.ID);
    if (fmt === 'КОМ') continue;
    const coId = String(cc[d.ID]?.COMPANY_ID || d.COMPANY_ID || '0');
    if (!companyHistory[coId]) companyHistory[coId] = [];
    companyHistory[coId].push({ date: d.CLOSEDATE || d.DATE_CREATE, title: d.TITLE });
  }

  const participants = [];
  const seen = new Set();

  for (const d of OOM_OM_DEALS) {
    const ccinfo = cc[d.ID] || {};
    const coId = String(ccinfo.COMPANY_ID || d.COMPANY_ID || '0');
    const contactId = String(ccinfo.CONTACT_ID || d.CONTACT_ID || '0');

    const companyName = companies[coId] || '—';
    const contactInfo = contactsExt[contactId] || contacts[contactId] || {};
    const contactName = contactInfo.name || (contactId !== '0' ? `Контакт #${contactId}` : '—');
    const opp = parseFloat(d.OPPORTUNITY || 0);
    const manager = users[String(d.ASSIGNED_BY_ID || '')] || String(d.ASSIGNED_BY_ID || '—');

    // Check history
    const prevDeals = companyHistory[coId] || [];
    const closedDate = d.CLOSEDATE || d.DATE_CREATE;
    let hadPrev = false;
    let prevDates = '';
    if (closedDate && prevDeals.length > 0) {
      const cd = new Date(closedDate.replace('+03:00', '').replace('+00:00', '').substring(0, 19));
      const earlier = prevDeals.filter(p => {
        if (!p.date) return false;
        const pd = new Date(p.date.replace('+03:00', '').replace('+00:00', '').substring(0, 19));
        return pd < cd;
      });
      hadPrev = earlier.length > 0;
      if (hadPrev) {
        const lastDate = earlier.reduce((a, b) => {
          const da = new Date(a.date.replace('+03:00', '').replace('+00:00', '').substring(0, 19));
          const db = new Date(b.date.replace('+03:00', '').replace('+00:00', '').substring(0, 19));
          return da > db ? a : b;
        }, earlier[0]);
        if (lastDate.date) {
          const d = new Date(lastDate.date.replace('+03:00', '').replace('+00:00', '').substring(0, 19));
          prevDates = d.toLocaleDateString('ru-RU');
        }
      }
    }

    // Дата обучения (для показа в таблице)
    const learnStart = toDate(d.UF_CRM_DATE_START_LEARN);
    const learnEnd = toDate(d.UF_CRM_DATE_END_LEARN);
    const displayDate = learnStart ? learnStart.toLocaleDateString('ru-RU') 
      : (learnEnd ? learnEnd.toLocaleDateString('ru-RU') 
      : (closedDate ? new Date(closedDate.replace('+03:00', '').replace('+00:00', '').substring(0, 19)).toLocaleDateString('ru-RU') : '—'));

    const key = d.ID;
    if (seen.has(key)) continue;
    seen.add(key);

    // Region resolution: contact → company fallback
    let region = (contactsExt[contactId]?.region || contactsExt[contactId]?.locality || '');
    if (!region && companiesExt[coId]?.region) {
      region = companiesExt[coId].region;
    }

    participants.push({
      id: d.ID,
      title: d.TITLE || '—',
      program: d.TITLE || '—',
      theme: d.TITLE ? d.TITLE.trim() : '—',
      participant: contactName,
      company: companyName,
      companyId: coId,
      amount: opp,
      date: displayDate,
      manager,
      hadPrevTraining: hadPrev,
      prevTrainingDate: prevDates,
      stage: d.STAGE_SEMANTIC_ID === 'S' ? 'WON' : d.STAGE_SEMANTIC_ID === 'F' ? 'LOSE' : 'В работе',
      isPaid: d.CLOSED === 'Y' && d.STAGE_SEMANTIC_ID === 'S',
      format: detectFormat(d.TITLE, cats[String(d.CATEGORY_ID || '0')], d.ID),
      region
    });
  }

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
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

export default app;

// --- Direct start (port mode) ---
const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  await loadCache();
  app.listen(PORT, '0.0.0.0', () => console.log(`🍀 Дроп-дашборд на http://0.0.0.0:${PORT}`));
} else {
  await loadCache();
}
