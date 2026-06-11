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

// ===== Live API: КОМ данные напрямую из B24 (с UF_FORMAT=19042498) =====
app.get('/api/live-data', async (req, res) => {
  const WEBHOOK = 'https://24.uprav.ru/rest/516/k1cdomfp4vd1kiql/';
  const monthNames = ['', 'Январь','Февраль','Март','Апрель','Май','Июнь',
                      'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

  async function b24All(method, params) {
    const all = []; let start = 0;
    while (true) {
      const body = Object.entries({...params, limit: '50', start: String(start)}).map(([k,v]) => {
        if (Array.isArray(v)) return v.map(x => encodeURIComponent(k) + '=' + encodeURIComponent(x)).join('&');
        return encodeURIComponent(k) + '=' + encodeURIComponent(v);
      }).join('&');
      const resp = await fetch(WEBHOOK + method, {
        method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body
      });
      const r = await resp.json();
      const items = r.result || [];
      if (!items.length) break;
      all.push(...items);
      if (r.next === undefined || r.next === null) break;
      start = r.next;
    }
    return all;
  }

  try {
    // 1. КОМ-формат (UF_FORMAT=19042498) + WON + оплачено в 2026
    const fmtIds = { '19042467': 'Очный', '19042468': 'Онлайн', '19042469': 'СДО', '19042498': 'КОМ' };
    
    const deals = await b24All('crm.deal.list', {
      'filter[UF_FORMAT]': '19042498',
      'filter[>=CLOSEDATE]': '2026-01-01T00:00:00',
      'filter[<=CLOSEDATE]': '2026-12-31T23:59:59',
      'filter[>OPPORTUNITY]': '0',
      'filter[STAGE_SEMANTIC_ID]': 'S',
      'select[]': ['ID', 'TITLE', 'OPPORTUNITY', 'UF_DATE_PAY_1C', 'CLOSEDATE', 'CATEGORY_ID', 'UF_FORMAT', 'ASSIGNED_BY_ID']
    });
    
    // 2. Также добавляем КОМ-копии (cat=19), WON, оплачено в 2026
    const komCopies = await b24All('crm.deal.list', {
      'filter[CATEGORY_ID]': '19',
      'filter[>=CLOSEDATE]': '2026-01-01T00:00:00',
      'filter[<=CLOSEDATE]': '2026-12-31T23:59:59',
      'filter[>OPPORTUNITY]': '0',
      'filter[STAGE_SEMANTIC_ID]': 'S',
      'select[]': ['ID', 'TITLE', 'OPPORTUNITY', 'UF_DATE_PAY_1C', 'CLOSEDATE', 'CATEGORY_ID', 'UF_FORMAT', 'ASSIGNED_BY_ID']
    });
    
    // Объединяем, избегая дубликатов
    const allDeals = [...deals];
    const seenIds = new Set(deals.map(d => d.ID));
    for (const d of komCopies) {
      if (!seenIds.has(d.ID)) {
        allDeals.push(d);
        seenIds.add(d.ID);
      }
    }
    
    // Исключаем копии для статистики (они дублируют реальные сделки)
    const realDeals = allDeals.filter(d => {
      const t = (d.TITLE || '').toLowerCase();
      return !t.includes('копия для статистики');
    });
    
    // Определяем месяц и неделю по UF_DATE_PAY_1C или CLOSEDATE
    function getDate(d) {
      const s = d.UF_DATE_PAY_1C || d.CLOSEDATE || '';
      return s.slice(0, 10);
    }
    
    function getMonth(d) {
      const s = getDate(d);
      if (!s) return 0;
      return parseInt(s.slice(5, 7), 10);
    }
    
    function isoWeek(dtStr) {
      const d = new Date(dtStr);
      d.setHours(0, 0, 0, 0);
      const day = (d.getDay() + 6) % 7;
      const thu = new Date(d);
      thu.setDate(thu.getDate() - day + 3);
      const firstThu = new Date(thu.getFullYear(), 0, 1);
      if (firstThu.getDay() !== 4) firstThu.setDate(firstThu.getDate() + ((4 - firstThu.getDay()) + 7) % 7);
      return 1 + Math.ceil((thu - firstThu) / 604800000);
    }
    
    function weekLabel(dtStr) {
      const d = new Date(dtStr);
      const wk = isoWeek(dtStr);
      const mon = new Date(d);
      mon.setDate(mon.getDate() - ((d.getDay() + 6) % 7));
      const sun = new Date(mon);
      sun.setDate(sun.getDate() + 6);
      const fmt = (dt) => String(dt.getDate()).padStart(2,'0') + '.' + String(dt.getMonth()+1).padStart(2,'0');
      return { label: 'W' + String(wk).padStart(2,'0'), dates: `${fmt(mon)}—${fmt(sun)}` };
    }
    
    // Monthly aggregation
    const monthlyData = {};
    // Weekly aggregation
    const weeklyData = {};
    
    for (const d of realDeals) {
      const dt = getDate(d);
      if (!dt) continue;
      const m = getMonth(d);
      const opp = parseFloat(d.OPPORTUNITY || 0);
      
      if (!monthlyData[m]) monthlyData[m] = { revenue: 0, count: 0, deals: [] };
      monthlyData[m].revenue += opp;
      monthlyData[m].count++;
      monthlyData[m].deals.push({ id: d.ID, title: d.TITLE, opp, date: dt });
      
      try {
        const wl = weekLabel(dt);
        const wkKey = `${2026}-W${isoWeek(dt).toString().padStart(2,'0')}`;
        if (!weeklyData[wkKey]) {
          weeklyData[wkKey] = { label: wl.label, dates: wl.dates, revenue: 0, count: 0, deals: [] };
        }
        weeklyData[wkKey].revenue += opp;
        weeklyData[wkKey].count++;
        weeklyData[wkKey].deals.push({ id: d.ID, title: d.TITLE, opp, date: dt });
      } catch(e) { /* skip week calc errors */ }
    }
    
    // Format output
    const monthly = Object.entries(monthlyData).sort((a,b) => parseInt(a[0]) - parseInt(b[0])).map(([m, v]) => ({
      monthName: monthNames[parseInt(m)] || m,
      revenue: Math.round(v.revenue),
      leads: v.count,
      registrations: v.count,
      paid: v.count,
      avgCheck: Math.round(v.revenue / v.count),
      conversion: 0, avgDuration: 0, trainingDays: 0, participants: 0
    }));
    
    const weekly = Object.entries(weeklyData).sort((a,b) => a[0].localeCompare(b[0])).map(([k, v]) => ({
      label: v.label,
      dates: v.dates,
      revenue: Math.round(v.revenue),
      leads: v.count,
      paid: v.count,
      avgCheck: Math.round(v.revenue / v.count),
      conversion: 0, avgDuration: 0, trainingDays: 0
    }));
    
    // Top deals by revenue
    const sortedDeals = [...realDeals].sort((a,b) => parseFloat(b.OPPORTUNITY||0) - parseFloat(a.OPPORTUNITY||0));
    const topDeals = sortedDeals.slice(0, 50).map((d, i) => ({
      rank: i + 1,
      title: d.TITLE || '',
      manager: d.ASSIGNED_BY_ID || '',
      revenue: Math.round(parseFloat(d.OPPORTUNITY||0)),
      clientType: 'new',
      trainStart: '—',
      trainEnd: '—',
      teacherFee: null,
      duration: 0,
      payDate: (d.UF_DATE_PAY_1C || d.CLOSEDATE || '').slice(0, 10) || '—'
    }));
    
    const totalRevenue = realDeals.reduce((s, d) => s + parseFloat(d.OPPORTUNITY||0), 0);
    
    res.json({
      ready: true,
      updatedAt: new Date().toISOString(),
      note: 'Данные по КОМ из B24 (UF_FORMAT=19042498). Июнь без поступлений.' + (realDeals.length !== allDeals.length ? ` Исключено ${allDeals.length - realDeals.length} копий для статистики.` : ''),
      kpi: {
        totalRevenue: Math.round(totalRevenue),
        totalLeads: realDeals.length,
        totalRegistered: realDeals.length,
        totalPaid: realDeals.length,
        avgCheck: Math.round(totalRevenue / realDeals.length),
        conversion: 0,
        avgDuration: 0,
        trainingDays: 0,
        participants: 0
      },
      monthly,
      weekly,
      topDeals
    });
  } catch (e) {
    res.status(500).json({ ready: false, error: e.message });
  }
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
