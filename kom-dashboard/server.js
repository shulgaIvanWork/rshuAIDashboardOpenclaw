import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3003;
const DATA_DIR = path.join(__dirname, 'data');
const CACHE_FILE = path.join(DATA_DIR, 'cache.json');

await fs.mkdir(DATA_DIR, { recursive: true }).catch(() => {});

// --- Состояние ---
let dataState = { ready: false, loading: false, error: null };
let cacheData = null;

function formatNumber(n) {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('ru-RU');
}

function formatCurrency(n) {
  if (n === null || n === undefined || n === 0) return '0 ₽';
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' ₽';
}

function formatDuration(n) {
  if (n === null || n === undefined || n === 0) return '0 дн.';
  return n + ' дн.';
}

function formatPercent(n) {
  if (n === null || n === undefined) return '0.0%';
  return n.toFixed(1) + '%';
}

async function loadCache() {
  try {
    const raw = await fs.readFile(CACHE_FILE, 'utf-8');
    cacheData = JSON.parse(raw);
    dataState.ready = true;
    console.log(`✓ Cache loaded: ${cacheData.monthly.length} months, ${cacheData.weekly.length} weeks, ${cacheData.topDeals.length} deals`);
  } catch (e) {
    console.error('No cache file found. Need refresh:', e.message);
    cacheData = null;
    dataState.ready = false;
  }
}

async function reloadData() {
  dataState.loading = true;
  dataState.error = null;
  try {
    await loadCache();
    dataState.ready = true;
    console.log('✓ Data reloaded');
  } catch (e) {
    dataState.error = e.message;
    console.error('✗ reloadData failed:', e.message);
  } finally {
    dataState.loading = false;
  }
}

// --- Express ---
const app = express();
app.use(express.json());

// Статус
app.get('/api/status', (req, res) => res.json(dataState));

// Все данные
app.get('/api/data', (req, res) => {
  if (!cacheData) return res.json({ ready: false, error: 'No data loaded' });
  res.json({
    ready: true,
    updatedAt: cacheData.updatedAt,
    kpi: cacheData.kpi,
    warningNote: cacheData.warningNote,
    dealsNote: cacheData.dealsNote,
    monthly: cacheData.monthly,
    weekly: cacheData.weekly,
    topDeals: cacheData.topDeals
  });
});

// Расширенные данные КОМ: компании и менеджеры
const CACHE_DIR = path.join(__dirname, 'cache');

async function loadKomEnriched() {
  try {
    const [companiesRaw, ccRaw, dictsRaw, dealsRaw, contactsRaw] = await Promise.all([
      fs.readFile(path.join(CACHE_DIR, 'companies.json'), 'utf-8').catch(() => '{}'),
      fs.readFile(path.join(CACHE_DIR, 'company_contact.json'), 'utf-8').catch(() => '{}'),
      fs.readFile(path.join(CACHE_DIR, 'dicts.json'), 'utf-8').catch(() => '{}'),
      fs.readFile(path.join(CACHE_DIR, 'deals_2026.json'), 'utf-8').catch(() => '[]'),
      fs.readFile(path.join(CACHE_DIR, 'contacts.json'), 'utf-8').catch(() => '{}'),
    ]);
    
    const companies = JSON.parse(companiesRaw);
    const cc = JSON.parse(ccRaw);
    const dicts = JSON.parse(dictsRaw);
    const deals = JSON.parse(dealsRaw);
    const contacts = JSON.parse(contactsRaw);
    const cats = dicts.categories || {};
    const sources = dicts.sources || {};
    const users = dicts.users || {};
    
    const KOM_CAT = "КОМ (Sale)";
    const komDeals = deals
      .filter(x => cats[String(x.CATEGORY_ID || '0')] === KOM_CAT)
      .filter(x => parseFloat(x.OPPORTUNITY || 0) >= 1);
    
    // Company → deals mapping (all deals + paid only)
    const companyMap = {}; // company_id → {name, deals: [], totalRevenue, dealCount, paidRevenue, paidCount}
    
    for (const x of komDeals) {
      const companyId = cc[x.ID]?.COMPANY_ID || '0';
      let companyName = companies[companyId] || '';
      if (!companyName) {
        // Try contact name instead
        const contactId = cc[x.ID]?.CONTACT_ID || '0';
        const contactInfo = contacts[contactId];
        if (contactInfo) {
          companyName = contactInfo.company_title || contactInfo.name || `Контакт #${contactId}`;
        } else {
          companyName = '—';
        }
      }
      const opp = parseFloat(x.OPPORTUNITY || 0);
      const manager = users[String(x.ASSIGNED_BY_ID || '')] || String(x.ASSIGNED_BY_ID || '—');
      // Duration: from cache.json or calculate from dates
      let duration = 0;
      if (x.DATE_CREATE && x.CLOSEDATE) {
        const dc = new Date(x.DATE_CREATE);
        const cl = new Date(x.CLOSEDATE);
        const diff = Math.round((cl - dc) / (1000 * 60 * 60 * 24));
        if (diff >= 0) duration = diff;
      }
      
      if (!companyMap[companyId]) {
        companyMap[companyId] = { id: companyId, name: companyName, deals: [], totalRevenue: 0, dealCount: 0, paidRevenue: 0, paidCount: 0, pendingRevenue: 0 };
      }
      const isPaid = x.STAGE_SEMANTIC_ID === 'S' && x.CLOSED === 'Y';
      companyMap[companyId].deals.push({
        id: x.ID,
        title: x.TITLE || '',
        revenue: opp,
        manager,
        closedate: x.CLOSEDATE || null,
        dateCreate: x.DATE_CREATE || null,
        stage: x.STAGE_SEMANTIC_ID || '',
        payDate: x.UF_DATE_PAY_1C || null,
        duration,
        isPaid,
      });
      companyMap[companyId].totalRevenue += opp;
      companyMap[companyId].dealCount += 1;
      if (isPaid) {
        companyMap[companyId].paidRevenue += opp;
        companyMap[companyId].paidCount += 1;
      } else {
        companyMap[companyId].pendingRevenue += opp;
      }
    }
    
    function enrichCompany(c, i) {
      // Темы из названий сделок
      const themes = [...new Set(c.deals.map(d => d.title).filter(t => t))];
      // Суммарная длительность
      const totalDuration = c.deals.reduce((s, d) => s + (d.duration || 0), 0);
      // Статусы сделок
      const stageLabels = { 'S': 'WON', 'F': 'LOSE', 'P': 'В работе' };
      return {
        rank: i + 1,
        name: c.name,
        totalRevenue: Math.round(c.totalRevenue),
        paidRevenue: Math.round(c.paidRevenue),
        pendingRevenue: Math.round(c.pendingRevenue),
        dealCount: c.dealCount,
        paidCount: c.paidCount,
        totalDuration,
        themes: themes.slice(0, 5),
        managers: [...new Set(c.deals.map(d => d.manager))],
        firstDeal: c.deals.reduce((a, d) => !a || d.dateCreate < a ? d.dateCreate : a, null),
        lastDeal: c.deals.reduce((a, d) => !a || d.dateCreate > a ? d.dateCreate : a, null),
        deals: c.deals.slice(0, 10).map(d => ({
          title: d.title,
          revenue: Math.round(d.revenue),
          manager: d.manager,
          stage: stageLabels[d.stage] || d.stage,
          dateCreate: d.dateCreate,
          payDate: d.payDate,
        })),
      };
    }

    // Компании КОМ: только те, что уже принесли доход (paidRevenue > 0)
    const companiesList = Object.values(companyMap)
      .filter(c => c.paidRevenue > 0)
      .sort((a, b) => b.paidRevenue - a.paidRevenue)
      .map((c, i) => enrichCompany(c, i));
    
    // Потенциальные продажи: в воронке, ещё не оплачены (pendingRevenue > 0)
    const potentialList = Object.values(companyMap)
      .filter(c => c.pendingRevenue > 0)
      .sort((a, b) => b.pendingRevenue - a.pendingRevenue)
      .map((c, i) => enrichCompany(c, i));
    
    // Manager → deals mapping
    const managerMap = {};
    for (const x of komDeals) {
      const manager = users[String(x.ASSIGNED_BY_ID || '')] || String(x.ASSIGNED_BY_ID || '—');
      const companyId = cc[x.ID]?.COMPANY_ID || '0';
      let companyName = companies[companyId] || '';
      if (!companyName) {
        const contactId = cc[x.ID]?.CONTACT_ID || '0';
        const contactInfo = contacts[contactId];
        companyName = (contactInfo && (contactInfo.company_title || contactInfo.name)) || '—';
      }
      const opp = parseFloat(x.OPPORTUNITY || 0);
      
      if (!managerMap[manager]) {
        managerMap[manager] = { name: manager, totalRevenue: 0, dealCount: 0, wonCount: 0, companies: new Set() };
      }
      managerMap[manager].totalRevenue += opp;
      managerMap[manager].dealCount += 1;
      if (x.STAGE_SEMANTIC_ID === 'S') managerMap[manager].wonCount += 1;
      managerMap[manager].companies.add(companyName);
    }
    
    const managersList = Object.values(managerMap)
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .map(m => ({
        name: m.name,
        totalRevenue: Math.round(m.totalRevenue),
        dealCount: m.dealCount,
        wonCount: m.wonCount,
        companies: [...m.companies].filter(c => c !== '—'),
      }));
    
    return { companies: companiesList, managers: managersList, potential: potentialList };
  } catch (e) {
    console.error('loadKomEnriched error:', e.message);
    return { companies: [], managers: [], error: e.message };
  }
}

app.get('/api/kom-extended', async (req, res) => {
  const data = await loadKomEnriched();
  res.json(data);
});

// Обновить данные
app.post('/api/refresh', (req, res) => {
  if (dataState.loading) return res.json({ ok: false, message: 'Already loading' });
  res.json({ ok: true, message: 'Data reload started' });
  reloadData();
});

// Выгрузка Excel
app.get('/api/export', (req, res) => {
  if (!cacheData) return res.status(503).json({ error: 'No data' });
  
  const XLSX_ROWS = [];
  
  // Заголовок
  XLSX_ROWS.push(['КОМ — Корпоративное обучение. Отчёт 2026']);
  XLSX_ROWS.push([]);
  
  // KPI
  XLSX_ROWS.push(['ОСНОВНЫЕ ПОКАЗАТЕЛИ']);
  XLSX_ROWS.push(['Показатель', 'Значение']);
  const k = cacheData.kpi;
  XLSX_ROWS.push(['Поступления КОМ', formatCurrency(k.totalRevenue)]);
  XLSX_ROWS.push(['Выручка КОМ', formatCurrency(k.totalRevenue)]);
  XLSX_ROWS.push(['Лиды КОМ', k.totalLeads]);
  XLSX_ROWS.push(['Регистрации КОМ', k.totalRegistered]);
  XLSX_ROWS.push(['Платящие КОМ', k.totalPaid]);
  XLSX_ROWS.push(['Ср. чек ПлатПольз', formatCurrency(k.avgCheck)]);
  XLSX_ROWS.push(['Конверсия Лиды→Плат', formatPercent(k.conversion)]);
  XLSX_ROWS.push(['Длительность закрытия', formatDuration(k.avgDuration)]);
  XLSX_ROWS.push(['Ср. чек сделки', formatCurrency(k.avgCheck)]);
  XLSX_ROWS.push(['Тренинг дней КОМ', k.trainingDays]);
  XLSX_ROWS.push(['Участников', k.participants]);
  XLSX_ROWS.push([]);
  
  // Ежемесячные
  XLSX_ROWS.push(['ЕЖЕМЕСЯЧНЫЕ ПОКАЗАТЕЛИ']);
  XLSX_ROWS.push(['Месяц', 'Поступления', 'Выручка', 'Лиды', 'Регистрации', 'Платящие', 'Ср. чек ПлатПольз', 'Конверсия %', 'Длит. закрытия', 'Трен. дней', 'Участников']);
  for (const m of cacheData.monthly) {
    XLSX_ROWS.push([
      m.monthName,
      formatCurrency(m.revenue),
      formatCurrency(m.revenue),
      m.leads,
      m.registrations,
      m.paid,
      formatCurrency(m.avgCheck),
      formatPercent(m.conversion),
      formatDuration(m.avgDuration),
      m.trainingDays,
      m.participants
    ]);
  }
  XLSX_ROWS.push([]);
  
  // Еженедельные
  XLSX_ROWS.push(['ЕЖЕНЕДЕЛЬНЫЕ ПОКАЗАТЕЛИ']);
  XLSX_ROWS.push(['Неделя', 'Даты', 'Выручка', 'Лиды', 'Платящие', 'Ср. чек', 'Конв. %', 'Длит. закрытия', 'Трен. дней']);
  for (const w of cacheData.weekly) {
    XLSX_ROWS.push([
      w.label, w.dates,
      formatCurrency(w.revenue),
      w.leads, w.paid,
      formatCurrency(w.avgCheck),
      formatPercent(w.conversion),
      formatDuration(w.avgDuration),
      w.trainingDays
    ]);
  }
  XLSX_ROWS.push([]);
  
  // ТОП сделок
  XLSX_ROWS.push(['ТОП СДЕЛОК ПО ОПЛАТЕ']);
  XLSX_ROWS.push(['#', 'Сделка / Менеджер', 'Поступления', 'Тип клиента', 'Нач. обучения', 'Конец обучения', 'Гонорар препод.', 'Длит. закрытия', 'Дата оплаты']);
  for (const d of cacheData.topDeals) {
    XLSX_ROWS.push([
      d.rank,
      (d.title || '') + ' — ' + (d.manager || ''),
      formatCurrency(d.revenue),
      d.clientType === 'repeat' ? 'Повторный' : d.clientType === 'new' ? 'Новый' : d.clientType,
      d.trainStart || '—',
      d.trainEnd || '—',
      d.teacherFee !== null ? formatCurrency(d.teacherFee) : '—',
      formatDuration(d.duration),
      d.payDate || '—'
    ]);
  }
  
  // Формируем CSV
  const csvContent = XLSX_ROWS.map(row => 
    row.map(cell => {
      const s = String(cell ?? '');
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }).join(',')
  ).join('\r\n');
  
  // Добавляем BOM для UTF-8
  const bom = '\uFEFF';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="KOM_dashboard_2026.csv"`);
  res.send(bom + csvContent);
});

// Статика
app.use(express.static(path.join(__dirname, 'public')));

// Запасной маршрут
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

export default app;

// --- Direct start (port mode) ---
const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  await loadCache();
  app.listen(PORT, '0.0.0.0', () => console.log(`KOM Dashboard running at http://0.0.0.0:${PORT}`));
} else {
  await loadCache();
}
