import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAgg, getCacheAt } from '@rshu/data-service/agg-cache.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DS_CACHE = path.resolve(__dirname, '../../data-service/cache');

// --- Express ---
const app = express();
app.use(express.json({ limit: '50mb' }));

// Status
app.get('/api/status', (req, res) => {
  const ts = getCacheAt();
  res.json({
    ready: ts > 0,
    loading: false,
    error: null,
    loadedAt: ts > 0 ? new Date(ts).toISOString() : null,
  });
});

// User info
app.get('/api/user', (req, res) => {
  res.json({ role: (req.user && req.user.role) || 'guest' });
});

// Main data
app.get('/api/data', async (req, res) => {
  try {
    res.json(await getAgg());
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
});

// New-logic data (same source — kept for UI compatibility)
app.get('/api/data/new', async (req, res) => {
  try {
    res.json(await getAgg());
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
});

// Refresh — data-service updates on its own schedule; this is a no-op for the client
app.post('/api/refresh', (req, res) => {
  res.json({ ok: true, message: 'Данные обновляются автоматически через data-service' });
});

app.post('/api/refresh/reset', (req, res) => {
  res.json({ ok: true, message: 'OK' });
});

// --- Helper: build participants list for a given week ---
async function buildParticipants(weekIndex) {
  const agg = await getAgg();
  const weeks = agg.weeks || [];
  const targetWeek = weeks[weekIndex];
  if (!targetWeek) return { participants: [], weekLabel: '—' };

  const wkLabel = targetWeek.label_short + ' (' + targetWeek.label_dates + ')';

  const [dealsRaw, companiesRaw, contactsRaw, dictsRaw] = await Promise.all([
    fs.readFile(path.join(DS_CACHE, 'deals.json'), 'utf-8').catch(() => '[]'),
    fs.readFile(path.join(DS_CACHE, 'companies.json'), 'utf-8').catch(() => '{}'),
    fs.readFile(path.join(DS_CACHE, 'contacts.json'), 'utf-8').catch(() => '{}'),
    fs.readFile(path.join(DS_CACHE, 'dicts.json'), 'utf-8').catch(() => '{}'),
  ]);

  const deals = JSON.parse(dealsRaw);
  const companies = JSON.parse(companiesRaw);
  const contacts = JSON.parse(contactsRaw);
  const dicts = JSON.parse(dictsRaw);

  const cats = dicts.categories || {};
  const users = dicts.users || {};

  const KOM_CATS = ['КОМ (Sale)', 'КОМ (Post Sale)'];

  function detectFormat(title, catName, ufFmt) {
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

  function isRealTraining(title, ufFmt) {
    const t = (title || '').toLowerCase();
    const skipWords = ['копия для статистики', 'входящий звонок', 'запрос программы',
      'запрос каталога', 'запрос на прораба', 'уход со страницы', 'получите консультацию',
      'лид-магнит', 'обратный звонок', 'тест-драйв'];
    for (const w of skipWords) {
      if (t.includes(w)) return false;
    }
    const realFormats = ['19042467', '19042468', '19042495'];
    if (realFormats.includes(ufFmt)) return true;
    if (t.length < 10 && (t.startsWith('запрос') || t === 'промо')) return false;
    return true;
  }

  function getLearnPeriod(d) {
    let start = toDate(d.UF_CRM_DATE_START_LEARN);
    let end = toDate(d.UF_CRM_DATE_END_LEARN);
    if (!start && !end) {
      const cd = toDate(d.CLOSEDATE);
      if (cd) { start = cd; end = cd; }
    }
    return { start, end };
  }

  function learnOverlapsWeek(d) {
    const p = getLearnPeriod(d);
    if (!p.start || !p.end) return false;
    return p.start <= range.end && p.end >= range.start;
  }

  const OOM_OM_DEALS = deals.filter(d => {
    const catName = cats[String(d.CATEGORY_ID || '0')];
    const fmt = detectFormat(d.TITLE, catName, d.UF_FORMAT);
    if (fmt !== 'ООМ (Очное)' && fmt !== 'ОМ (Онлайн)') return false;
    if (d.STAGE_SEMANTIC_ID !== 'S') return false;
    if (d.CLOSED !== 'Y') return false;
    if (!learnOverlapsWeek(d)) return false;
    const opp = parseFloat(d.OPPORTUNITY || 0);
    if (opp > 0) return true;
    return isRealTraining(d.TITLE, d.UF_FORMAT);
  });

  // Build company history
  const companyHistory = {};
  for (const d of deals) {
    const catName = cats[String(d.CATEGORY_ID || '0')];
    const fmt = detectFormat(d.TITLE, catName, d.UF_FORMAT);
    if (fmt === 'КОМ') continue;
    const coId = String(d.COMPANY_ID || '0');
    if (!companyHistory[coId]) companyHistory[coId] = [];
    companyHistory[coId].push({ date: d.CLOSEDATE || d.DATE_CREATE, title: d.TITLE });
  }

  const participants = [];
  const seen = new Set();

  for (const d of OOM_OM_DEALS) {
    const coId = String(d.COMPANY_ID || '0');
    const contactId = String(d.CONTACT_ID || '0');

    const companyName = companies[coId] || '—';
    const contactInfo = contacts[contactId] || {};
    const contactName = contactInfo.name || (contactId !== '0' ? `Контакт #${contactId}` : '—');
    const opp = parseFloat(d.OPPORTUNITY || 0);
    const manager = users[String(d.ASSIGNED_BY_ID || '')] || String(d.ASSIGNED_BY_ID || '—');

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
          const dt = new Date(lastDate.date.replace('+03:00', '').replace('+00:00', '').substring(0, 19));
          prevDates = dt.toLocaleDateString('ru-RU');
        }
      }
    }

    const learnStart = toDate(d.UF_CRM_DATE_START_LEARN);
    const learnEnd = toDate(d.UF_CRM_DATE_END_LEARN);
    const displayDate = learnStart ? learnStart.toLocaleDateString('ru-RU')
      : (learnEnd ? learnEnd.toLocaleDateString('ru-RU')
      : (closedDate ? new Date(closedDate.replace('+03:00', '').replace('+00:00', '').substring(0, 19)).toLocaleDateString('ru-RU') : '—'));

    const key = d.ID;
    if (seen.has(key)) continue;
    seen.add(key);

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
      format: detectFormat(d.TITLE, cats[String(d.CATEGORY_ID || '0')], d.UF_FORMAT),
      region: '',
    });
  }

  participants.sort((a, b) => {
    if (a.date === '—') return 1;
    if (b.date === '—') return -1;
    return b.date.localeCompare(a.date);
  });

  return { participants, total: participants.length, weekLabel: wkLabel };
}

// Participants: previous week
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

// Participants: current week
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

// Static files
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

app.get(/(.*)/,  (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

export default app;
