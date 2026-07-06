import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAgg, getCacheAt } from '@rshu/data-service/agg-cache.js';
// Единые бизнес-правила (раньше здесь была локальная копия isKomDeal
// БЕЗ проверки направления 1906 — она расходилась с analyze.js)
import { isKomDeal, MIN_OPP, YEAR } from '@rshu/data-service/lib/deal-rules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DS_CACHE = path.resolve(__dirname, '../../data-service/cache');

const app = express();
app.use(express.json());

const MONTH_NAMES = ['','Январь','Февраль','Март','Апрель','Май','Июнь',
                     'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

function weekToMonth(labelDates) {
  try {
    const start = (labelDates || '').split('—')[0].trim();
    const parts = start.split('.');
    return parts.length === 2 ? parseInt(parts[1]) : null;
  } catch { return null; }
}

// ── /api/data ─────────────────────────────────────────────────────────────────
app.get('/api/data', async (req, res) => {
  try {
    const d = await getAgg();
    if (!d) return res.json({ ready: false, error: 'Нет данных — дождитесь первой загрузки' });

    const komYtd      = d.kom_ytd || {};
    const totalRevenue = komYtd.postupleniya || 0;
    const totalPaid    = komYtd.won_relevant_cnt || 0;
    const totalLeads   = d.kom_leads_ytd || 0;

    // Weekly KOM — weeks with KOM activity
    const weeks = (d.weeks || []).filter(w => (w.kom_postupleniya || 0) > 0 || (w.kom_won_cnt || 0) > 0);
    const weekly = weeks.map(w => {
      const komLeads = Math.max(0, (w.leads || 0) - (w.oom_leads || 0));
      const komPaid  = w.kom_won_cnt || 0;
      const komRev   = w.kom_postupleniya || 0;
      return {
        label:      w.label_short || '',
        dates:      w.label_dates || '',
        revenue:    Math.round(komRev),
        leads:      komLeads,
        paid:       komPaid,
        avgCheck:   komPaid ? Math.round(komRev / komPaid) : 0,
        conversion: komLeads ? +(komPaid / komLeads * 100).toFixed(1) : 0,
        avgDuration: Math.round(w.kom_avg_dur || 0),
        trainingDays: 0,
      };
    });

    // Monthly (aggregate weeks)
    const monthMap = {};
    for (const w of weekly) {
      const m = weekToMonth(w.dates);
      if (!m) continue;
      if (!monthMap[m]) monthMap[m] = { revenue: 0, leads: 0, paid: 0, dur_sum: 0, dur_cnt: 0 };
      monthMap[m].revenue += w.revenue;
      monthMap[m].leads   += w.leads;
      monthMap[m].paid    += w.paid;
      if (w.paid && w.avgDuration) { monthMap[m].dur_sum += w.avgDuration * w.paid; monthMap[m].dur_cnt += w.paid; }
    }
    const monthly = Object.entries(monthMap).sort(([a], [b]) => +a - +b).map(([m, v]) => ({
      monthName:     MONTH_NAMES[+m] || m,
      revenue:       v.revenue,
      leads:         v.leads,
      registrations: 0,
      paid:          v.paid,
      avgCheck:      v.paid ? Math.round(v.revenue / v.paid) : 0,
      conversion:    v.leads ? +(v.paid / v.leads * 100).toFixed(1) : 0,
      avgDuration:   v.dur_cnt ? Math.round(v.dur_sum / v.dur_cnt) : 0,
      trainingDays:  0,
      participants:  0,
    }));

    // Top KOM deals from raw cache
    let topDeals = [];
    try {
      const [dealsRaw, dictsRaw] = await Promise.all([
        fs.readFile(path.join(DS_CACHE, 'deals.json'), 'utf-8'),
        fs.readFile(path.join(DS_CACHE, 'dicts.json'), 'utf-8'),
      ]);
      const deals = JSON.parse(dealsRaw);
      const users = (JSON.parse(dictsRaw)).users || {};

      topDeals = deals
        .filter(x =>
          isKomDeal(x) &&
          x.STAGE_SEMANTIC_ID === 'S' &&
          parseFloat(x.OPPORTUNITY || 0) >= MIN_OPP &&
          new Date(x.DATE_CREATE).getFullYear() === YEAR
        )
        .sort((a, b) => parseFloat(b.OPPORTUNITY) - parseFloat(a.OPPORTUNITY))
        .slice(0, 50)
        .map((x, i) => ({
          rank:       i + 1,
          title:      x.TITLE || '',
          manager:    users[String(x.ASSIGNED_BY_ID || '')] || '—',
          revenue:    Math.round(parseFloat(x.OPPORTUNITY || 0)),
          clientType: /повтор|2 группа|3 группа/i.test(x.TITLE || '') ? 'repeat' : 'new',
          trainStart: x.UF_CRM_DATE_START_LEARN || '—',
          trainEnd:   x.UF_CRM_DATE_END_LEARN   || '—',
          teacherFee: null,
          duration:   0,
          payDate:    x.UF_DATE_PAY_1C || x.CLOSEDATE || '—',
        }));
    } catch { /* deals cache not yet ready */ }

    res.json({
      ready: true,
      updatedAt: d.fetched_at || new Date(getCacheAt()).toISOString(),
      kpi: {
        totalRevenue:    Math.round(totalRevenue),
        totalLeads,
        totalRegistered: totalLeads,
        totalPaid,
        avgCheck:    totalPaid ? Math.round(totalRevenue / totalPaid) : 0,
        conversion:  totalLeads ? +(totalPaid / totalLeads * 100).toFixed(1) : 0,
        avgDuration: Math.round(komYtd.avg_dur || 0),
        trainingDays: 0,
        participants: 0,
      },
      dealsNote: `КОМ оплачено: ${totalPaid} сделок · ${Math.round(totalRevenue).toLocaleString('ru-RU')} ₽`,
      monthly,
      weekly,
      topDeals,
      _loadedAt: d.fetched_at || new Date(getCacheAt()).toISOString(),
    });
  } catch (e) {
    res.status(500).json({ ready: false, error: e.message });
  }
});

// ── /api/kom-extended — компании, менеджеры, потенциал ───────────────────────
app.get('/api/kom-extended', async (req, res) => {
  try {
    const [dealsRaw, dictsRaw, companiesRaw, contactsRaw] = await Promise.all([
      fs.readFile(path.join(DS_CACHE, 'deals.json'),    'utf-8'),
      fs.readFile(path.join(DS_CACHE, 'dicts.json'),    'utf-8'),
      fs.readFile(path.join(DS_CACHE, 'companies.json'), 'utf-8').catch(() => '{}'),
      fs.readFile(path.join(DS_CACHE, 'contacts.json'),  'utf-8').catch(() => '{}'),
    ]);
    const deals    = JSON.parse(dealsRaw);
    const users    = (JSON.parse(dictsRaw)).users || {};
    const companyNames = JSON.parse(companiesRaw);
    const contacts = JSON.parse(contactsRaw);

    const komDeals = deals.filter(x => isKomDeal(x) && parseFloat(x.OPPORTUNITY || 0) >= MIN_OPP);

    // Company enrichment
    const companyMap = {};
    for (const x of komDeals) {
      const companyId = String(x.COMPANY_ID || '0');
      let name = companyNames[companyId] || '';
      if (!name) {
        const contactId = String(x.CONTACT_ID || '0');
        const ct = contacts[contactId];
        name = (ct && (ct.company_title || ct.name)) || '—';
      }
      const opp     = parseFloat(x.OPPORTUNITY || 0);
      const isPaid  = x.STAGE_SEMANTIC_ID === 'S';
      const manager = users[String(x.ASSIGNED_BY_ID || '')] || '—';

      if (!companyMap[companyId]) {
        companyMap[companyId] = { id: companyId, name, totalRevenue: 0, dealCount: 0, paidRevenue: 0, paidCount: 0, pendingRevenue: 0, managers: new Set(), themes: [] };
      }
      const c = companyMap[companyId];
      c.totalRevenue += opp;
      c.dealCount++;
      c.managers.add(manager);
      if (x.TITLE) c.themes.push(x.TITLE);
      if (isPaid) { c.paidRevenue += opp; c.paidCount++; }
      else c.pendingRevenue += opp;
    }

    const enrich = (c, i) => ({
      rank:           i + 1,
      name:           c.name,
      totalRevenue:   Math.round(c.totalRevenue),
      paidRevenue:    Math.round(c.paidRevenue),
      pendingRevenue: Math.round(c.pendingRevenue),
      dealCount:      c.dealCount,
      paidCount:      c.paidCount,
      managers:       [...c.managers].filter(m => m !== '—'),
      themes:         [...new Set(c.themes)].slice(0, 5),
    });

    const companies = Object.values(companyMap).filter(c => c.paidRevenue > 0)
      .sort((a, b) => b.paidRevenue - a.paidRevenue).map(enrich);
    const potential = Object.values(companyMap).filter(c => c.pendingRevenue > 0)
      .sort((a, b) => b.pendingRevenue - a.pendingRevenue).map(enrich);

    // Manager stats
    const managerMap = {};
    for (const x of komDeals) {
      const name = users[String(x.ASSIGNED_BY_ID || '')] || '—';
      if (!managerMap[name]) managerMap[name] = { name, totalRevenue: 0, dealCount: 0, wonCount: 0, companies: new Set() };
      const m = managerMap[name];
      m.totalRevenue += parseFloat(x.OPPORTUNITY || 0);
      m.dealCount++;
      if (x.STAGE_SEMANTIC_ID === 'S') m.wonCount++;
      const cid = String(x.COMPANY_ID || '0');
      m.companies.add(companyNames[cid] || '—');
    }
    const managers = Object.values(managerMap)
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .map(m => ({ ...m, totalRevenue: Math.round(m.totalRevenue), companies: [...m.companies].filter(c => c !== '—') }));

    res.json({ companies, managers, potential });
  } catch (e) {
    res.status(500).json({ error: e.message, companies: [], managers: [], potential: [] });
  }
});

// ── Static ────────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  },
}));
app.get(/(.*)/, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3007;
const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) app.listen(PORT, '0.0.0.0', () => console.log(`KOM Dashboard: http://0.0.0.0:${PORT}`));

export default app;
