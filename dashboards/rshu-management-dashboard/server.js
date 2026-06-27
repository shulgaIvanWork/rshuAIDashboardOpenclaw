import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import { analyze } from './analyze.js';

// Sub-apps
import testDashboard from '../test-dashboard/server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3000', 10);
const SCRIPTS_DIR = path.join(__dirname, 'scripts');
const CACHE_DIR = path.join(__dirname, 'cache');
const PYTHON_BIN = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');

await fs.mkdir(CACHE_DIR, { recursive: true }).catch(() => {});

// --- Шаги прогресса ---
const STEP_WEIGHTS = [
  { key: 'analyze', label: 'Анализ данных', weight: 100 },
];

function initProgressSteps() {
  return STEP_WEIGHTS.map(s => ({
    key: s.key,
    label: s.label,
    weight: s.weight,
    done: false,
    current: 0,
    total: 0,
  }));
}

function calcProgressPct(steps, curIdx) {
  if (!steps) return 0;
  var pct = 0;
  // Примерное кол-во сделок для шага fetch_rest (когда total=0)
  var ESTIMATED_TOTAL_DEALS = 12000;
  for (var i = 0; i < steps.length; i++) {
    if (steps[i].done) {
      pct += steps[i].weight;
    } else if (i === curIdx && steps[i].current > 0) {
      var total = steps[i].total > 0 ? steps[i].total : ESTIMATED_TOTAL_DEALS;
      pct += steps[i].weight * Math.min(steps[i].current / total, 1);
    }
  }
  return Math.round(pct);
}

// --- State ---
const dataState = {
  ready: false,
  loading: false,
  error: null,
  loadedAt: null,
  startedAt: null,
  progressSteps: null,
  progressPct: 0,
  currentStepIdx: -1,
  loadingPhase: null,
  loadingProgress: null,
};

let aggCache = null;

// --- Load cache ---
async function loadCache() {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(CACHE_DIR, 'agg.json'), 'utf-8'));
    // OOM/KOM данные берутся из agg.json (рассчитываются в analyze_new.py)
    // Больше не копируем из ytd — это затирало правильные OOM-цифры
    aggCache = raw;
    dataState.ready = true;
    dataState.loadedAt = new Date().toISOString();
    console.log(`✓ Cache loaded: ${aggCache.weeks.length} weeks, ${aggCache.ytd.won_relevant_cnt} deals`);
  } catch (e) {
    console.log('Cache not found:', e.message);
  }
}

// --- Refresh: JS analyze() ---

function resetLoading() {
  dataState.loading = false;
  dataState.error = 'Сброшено принудительно';
  dataState.startedAt = null;
  dataState.progressSteps = null;
  dataState.progressPct = 0;
  dataState.currentStepIdx = -1;
  dataState.loadingProgress = null;
  dataState.loadingPhase = null;
  console.log('🔄 Loading state reset');
}

function handleProgressMsg(msg) {
  switch (msg.type) {
    case 'step_start': {
      const idx = msg.idx;
      dataState.currentStepIdx = idx;
      dataState.loadingPhase = (dataState.progressSteps && dataState.progressSteps[idx])
        ? dataState.progressSteps[idx].label : 'Шаг ' + (idx + 1);
      break;
    }
    case 'step_done': {
      const idx = msg.idx;
      if (dataState.progressSteps && dataState.progressSteps[idx]) {
        dataState.progressSteps[idx].done = true;
      }
      dataState.progressPct = calcProgressPct(dataState.progressSteps, dataState.currentStepIdx);
      break;
    }
    case 'deals_loaded': {
      dataState.progressPct = 50;
      dataState.loadingProgress = { current: msg.count || 0, total: 0 };
      break;
    }
    case 'finalizing': { dataState.loadingPhase = 'Финализация...'; break; }
    case 'all_done':   { dataState.loadingPhase = 'Загрузка завершена'; break; }
  }
}

async function runRefresh() {
  if (dataState.loading) throw new Error('Already loading');
  dataState.loading = true;
  dataState.error = null;
  dataState.startedAt = new Date().toISOString();
  dataState.progressSteps = initProgressSteps();
  dataState.progressPct = 0;
  dataState.currentStepIdx = -1;
  dataState.loadingProgress = null;
  dataState.loadingPhase = 'Анализ данных...';

  try {
    const result = await analyze((msg) => handleProgressMsg(msg));
    aggCache = result;
    dataState.ready = true;
    dataState.loadedAt = new Date().toISOString();
    dataState.loading = false;
    dataState.startedAt = null;
    dataState.loadingProgress = null;
    dataState.loadingPhase = null;
    // Сохраняем в agg.json для холодного старта
    await fs.writeFile(path.join(CACHE_DIR, 'agg.json'), JSON.stringify(result), 'utf-8').catch(() => {});
    return true;
  } catch (e) {
    console.error('Analyze error:', e.message);
    dataState.error = e.message;
    dataState.loading = false;
    dataState.startedAt = null;
    dataState.loadingProgress = null;
    dataState.loadingPhase = null;
    throw e;
  }
}

// --- Express ---
const app = express();
app.set('etag', false); // отключаем ETag, чтобы браузер не кэшировал
app.use(express.json({ limit: '50mb' }));

// Status
app.get('/api/status', (req, res) => res.json(dataState));

// User info (role from auth middleware in clover-web)
app.get('/api/user', (req, res) => {
  res.json({ role: (req.user && req.user.role) || 'guest' });
});

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
    const [raw, stat] = await Promise.all([
      fs.readFile(aggNewPath, 'utf-8'),
      fs.stat(aggNewPath)
    ]);
    const data = JSON.parse(raw);
    data._loadedAt = stat.mtime.toISOString();
    res.json(data);
  } catch (e) {
    res.status(503).json({ error: 'New logic data not loaded' });
  }
});

app.post('/api/refresh', async (req, res) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ ok: false, message: 'Only admins can refresh data' });
  }
  if (dataState.loading) return res.json({ ok: false, message: 'Already loading' });
  res.json({ ok: true, message: 'Refresh started' });
  runRefresh().catch(e => console.error('Refresh failed:', e.message || e));
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
    
    // Форматы без UF_FORMAT (правило 2: ключевые слова)
    const formatRule2 = withPay
      .filter(d => {
        if (parseFloat(d.OPPORTUNITY || 0) < 11) return false;
        if (!['0','8','19'].includes(String(d.CATEGORY_ID))) return false;
        if (d.UF_FORMAT) return false;
        return true;
      })
      .map(d => ({
        id: d.ID, title: d.TITLE, sum: parseFloat(d.OPPORTUNITY) || 0,
        date: d.UF_DATE_PAY_1C, cat: d.CATEGORY_ID
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
    
    // Старые сделки Sale в работе (2024 и старше, с ненулевой суммой)
    const oldActive = deals
      .filter(d => {
        const dc = d.DATE_CREATE || '';
        const yr = dc.substring(0, 4);
        if (yr !== '2024' && yr !== '2023') return false;
        if (String(d.CATEGORY_ID) !== '0') return false;
        if (d.STAGE_SEMANTIC_ID !== 'P') return false;
        const opp = parseFloat(d.OPPORTUNITY) || 0;
        return opp > 0;
      })
      .map(d => ({
        id: d.ID, title: d.TITLE, sum: parseFloat(d.OPPORTUNITY) || 0,
        date: d.DATE_CREATE, stage: d.STAGE_ID
      }));
    
    // Сделки с UF_FORMAT=19042495 (MMBA, требуется уточнение: Личная эффективность, формат СДО)
    const mmbaDeals = deals
      .filter(d => String(d.UF_FORMAT) === '19042495' && (parseFloat(d.OPPORTUNITY) || 0) > 0)
      .map(d => ({
        id: d.ID, title: d.TITLE, sum: parseFloat(d.OPPORTUNITY) || 0,
        cat: d.CATEGORY_ID, pay: d.UF_DATE_PAY_1C
      }));
    
    // Сделки из регистрации, оплаченные без даты счёта (правило: дата счёта = дате оплаты)
    const autopayDeals = deals
      .filter(d => {
        if (String(d.UF_CRM_1765896709800 || '') === '34765') return false; // КОМ — не автооплата
        if (!d.UF_DATE_PAY_1C) return false;
        if (String(d.UF_CRM_1753272713011 || '')) return false; // есть дата счёта
        if (String(d.SOURCE_ID || '') !== '79641902890') return false; // только регистрации
        const opp = parseFloat(d.OPPORTUNITY) || 0;
        if (opp < 11) return false;
        if (!['0','8','19'].includes(String(d.CATEGORY_ID))) return false;
        return true;
      })
      .map(d => ({
        id: d.ID, title: d.TITLE, sum: parseFloat(d.OPPORTUNITY) || 0,
        pay: d.UF_DATE_PAY_1C
      }));
    
    // Сделки без типа обучения (UF_CRM_1765896709800 пустое)
    const noTypeEdu = deals
      .filter(d => {
        if (!d.UF_DATE_PAY_1C) return false;
        try {
          const payY = parseInt(d.UF_DATE_PAY_1C.substring(0, 4));
          if (payY !== 2026) return false;
        } catch(e) { return false; }
        const opp = parseFloat(d.OPPORTUNITY) || 0;
        if (opp < 11) return false;
        if (!['0','8','19'].includes(String(d.CATEGORY_ID))) return false;
        return !String(d.UF_CRM_1765896709800 || '').trim();
      })
      .map(d => ({
        id: d.ID, title: d.TITLE, sum: parseFloat(d.OPPORTUNITY) || 0,
        pay: d.UF_DATE_PAY_1C
      }));
    
    // Сделка #240316 — специальный артефакт (старая, в работе, с суммой, не входит в выгрузку 2025-2026)
    if (!oldActive.some(a => String(a.id) === '240316')) {
      oldActive.push({
        id: '240316',
        title: 'Micro MBA. Маркетинг 27-28.06.2025 в г. Москва',
        sum: 42500,
        date: '2024-10-07',
        stage: 'C0:2'
      });
    }
    
    res.json({
      summary: {
        returns: { cnt: returns.length, sum: returns.reduce((a,b) => a + b.sum, 0) },
        inProgressPaid: { cnt: inProgressPaid.length, sum: inProgressPaid.reduce((a,b) => a + b.sum, 0) },
        wonNoPay: { cnt: wonNoPay.length, sum: wonNoPay.reduce((a,b) => a + (parseFloat(b.OPPORTUNITY) || 0), 0) },
        tech: { cnt: tech.length, sum: 0 },
        negativeDuration: { cnt: negativeDur.length, sum: negativeDur.reduce((a,b) => a + (parseFloat(b.OPPORTUNITY) || 0), 0) },
        otherCatPaid: { cnt: otherCatPaid.length, sum: otherCatPaid.reduce((a,b) => a + b.sum, 0) },
        komInPresale: { cnt: komInPresale.length },
        nextYear: { cnt: nextYear.length, sum: nextYear.reduce((a,b) => a + b.sum, 0) },
        formatRule2: { cnt: formatRule2.length, sum: formatRule2.reduce((a,b) => a + b.sum, 0) },
        oldActive: { cnt: oldActive.length, sum: oldActive.reduce((a,b) => a + b.sum, 0) },
        mmbaDeals: { cnt: mmbaDeals.length, sum: mmbaDeals.reduce((a,b) => a + b.sum, 0) },
        noTypeEdu: { cnt: noTypeEdu.length, sum: noTypeEdu.reduce((a,b) => a + b.sum, 0) },
        autopayDeals: { cnt: autopayDeals.length, sum: autopayDeals.reduce((a,b) => a + b.sum, 0) }
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
        nextYear: nextYear.slice(0, 50),
        formatRule2: formatRule2.slice(0, 50),
        oldActive: oldActive.slice(0, 50),
        mmbaDeals: mmbaDeals.slice(0, 50),
        noTypeEdu: noTypeEdu.slice(0, 50),
        autopayDeals: autopayDeals.slice(0, 50)
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
    const proc = spawn(PYTHON_BIN, [script], {
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

// Раздача session-файлов (лог, решения, TODO)
app.use('/sessions', express.static(path.join(__dirname, 'sessions'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.md')) res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  }
}));

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
