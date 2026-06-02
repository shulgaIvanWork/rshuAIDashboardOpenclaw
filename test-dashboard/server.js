import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import https from 'https';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3004;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============== КОНСТАНТЫ ==============
const METRIKA_OAUTH = 'y0__wgBELrbs5oCGKr3QiDt4u3iF6ydZv9PW4NDN8I-iaAaFC-A6UfL';
const METRIKA_COUNTER = 1207553;
const METRIKA_BASE = 'https://api-metrika.yandex.net';

const ROISTAT_KEY = 'ac4693c25f23612c38a6bfaec8d5a00f';
const ROISTAT_PROJECT = 229682;
const ROISTAT_BASE = 'https://cloud.roistat.com/api/v1';

const BITRIX_WEBHOOK = 'https://24.uprav.ru/rest/479/a98jbqufylu1si1e';

// ============== УТИЛИТЫ ==============
function fetchUrl(url, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https');
    const mod = isHttps ? https : http;
    const urlObj = new URL(url);
    const opts = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: body ? 'POST' : 'GET',
      headers: {
        'User-Agent': 'Clover/1.0',
        ...headers
      },
      timeout: 30000
    };
    const req = mod.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch {
          resolve({ raw: data, status: res.statusCode });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

// ============== API: Метрика ==============
app.get('/api/metrika-visits', async (req, res) => {
  try {
    const data = await fetchUrl(
      `${METRIKA_BASE}/stat/v1/data?ids=${METRIKA_COUNTER}&date1=2026-05-01&date2=2026-05-31&metrics=ym:s:visits,ym:s:pageviews,ym:s:users&dimensions=ym:s:date&limit=31&sort=ym:s:date`,
      { 'Authorization': `OAuth ${METRIKA_OAUTH}` }
    );
    const rows = (data.data || []).map(d => ({
      date: d.dimensions[0].name,
      visits: d.metrics[0],
      pageviews: d.metrics[1],
      users: d.metrics[2]
    }));
    res.json({ totals: data.totals, rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/metrika-sources', async (req, res) => {
  try {
    const data = await fetchUrl(
      `${METRIKA_BASE}/stat/v1/data?ids=${METRIKA_COUNTER}&date1=2026-05-01&date2=2026-05-31&metrics=ym:s:visits,ym:s:users&dimensions=ym:s:trafficSource&limit=20`,
      { 'Authorization': `OAuth ${METRIKA_OAUTH}` }
    );
    const rows = (data.data || []).map(d => ({
      id: d.dimensions[0].id,
      name: d.dimensions[0].name,
      visits: d.metrics[0],
      users: d.metrics[1]
    }));
    res.json({ totals: data.totals, data: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/metrika-sources-by-day', async (req, res) => {
  // For source+date breakdown — limited scope
  try {
    const data = await fetchUrl(
      `${METRIKA_BASE}/stat/v1/data?ids=${METRIKA_COUNTER}&date1=2026-05-01&date2=2026-05-31&metrics=ym:s:visits&dimensions=ym:s:trafficSource,ym:s:date&limit=500&sort=ym:s:date`,
      { 'Authorization': `OAuth ${METRIKA_OAUTH}` }
    );
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============== API: Roistat ==============
app.get('/api/roistat-orders', async (req, res) => {
  try {
    const data = await fetchUrl(
      `${ROISTAT_BASE}/project/integration/order/list?project=${ROISTAT_PROJECT}&date_from=2026-05-01&date_to=2026-05-31&limit=50`,
      { 'Api-key': ROISTAT_KEY }
    );
    const total = data.total || 0;
    // source breakdown from sample
    const srcCount = {};
    (data.data || []).forEach(o => {
      const src = o.source_type || 'Не указан';
      srcCount[src] = (srcCount[src] || 0) + 1;
    });
    const bySource = Object.entries(srcCount).map(([k,v]) => ({ source: k, count: v }));
    res.json({ total, by_source_sample: bySource });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/roistat-calls', async (req, res) => {
  try {
    const data = await fetchUrl(
      `${ROISTAT_BASE}/project/calltracking/call/list?project=${ROISTAT_PROJECT}&date_from=2026-05-01&date_to=2026-05-31&limit=5000&is_new=1`,
      { 'Api-key': ROISTAT_KEY }
    );
    const total = data.total || 0;
    const calls = data.data || [];
    const callers = new Set();
    let answered = 0, totalDuration = 0;
    calls.forEach(c => {
      if (c.caller) callers.add(c.caller);
      const dur = parseInt(c.duration) || 0;
      if (dur > 0) { answered++; totalDuration += dur; }
    });
    // Filter to May only
    const mayCalls = calls.filter(c => (c.date || '').startsWith('2026-05'));
    const mayAnswered = mayCalls.filter(c => (parseInt(c.duration)||0) > 0);
    const mayCallers = new Set(mayCalls.map(c => c.caller).filter(Boolean));
    const mayDuration = mayAnswered.reduce((s,c) => s + (parseInt(c.duration)||0), 0);
    // by day (May only)
    const byDay = {};
    mayCalls.forEach(c => {
      const day = (c.date || '').slice(0, 10);
      if (!day) return;
      if (!byDay[day]) byDay[day] = { count: 0, answered: 0, total_duration: 0 };
      byDay[day].count++;
      const dur = parseInt(c.duration) || 0;
      if (dur > 0) {
        byDay[day].answered++;
        byDay[day].total_duration += dur;
      }
    });
    const byDayArr = Object.entries(byDay).sort().map(([date, v]) => ({
      date,
      count: v.count,
      answered: v.answered,
      avg_duration: v.answered > 0 ? v.total_duration / v.answered : 0
    }));

    res.json({
      summary: {
        total,
        answered: mayAnswered.length,
        unique_callers: mayCallers.size,
        avg_duration: mayAnswered.length > 0 ? mayDuration / mayAnswered.length : 0
      },
      by_day: byDayArr
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============== API: Product Ranking ==============
app.get('/api/product-ranking', (req, res) => {
  try {
    const xlsPath = '/root/.openclaw/media/inbound/выгрузка_май_2026---9ad4389d-5044-4205-9365-619164f35751.xls';
    if (!fs.existsSync(xlsPath)) {
      return res.json({ error: 'Файл выгрузки не найден' });
    }
    const html = fs.readFileSync(xlsPath, 'utf-8');
    const rows = html.match(/<tr>(.*?)<\/tr>/gs) || [];
    const data = [];
    for (let ri = 1; ri < rows.length; ri++) {
      const cells = rows[ri].match(/<td[^>]*>(.*?)<\/td>/gs);
      if (cells) {
        const row = cells.map(c => c.replace(/<[^>]+>/g, '').trim());
        data.push(row);
      }
    }
    
    function cleanTitle(t) {
      if (!t) return 'Unknown';
      let t2 = t;
      t2 = t2.replace(/НЕ удалять пока! /gi, '');
      t2 = t2.replace(/\d{2}\.\d{2}\.\d{4}/g, '');
      t2 = t2.replace(/\d{4}-\d{2}-\d{2}/g, '');
      t2 = t2.replace(/с \d{2}\.\d{2}\.\d{4}/g, '');
      t2 = t2.replace(/по \d{2}\.\d{2}\.\d{4}/g, '');
      t2 = t2.replace(/\d{1,2}-\d{1,2}\.\d{2}\.\d{4}/g, '');
      t2 = t2.replace(/в г\.\s*\S+[\S]*/g, '');
      t2 = t2.replace(/\(Москва\)/g, '');
      t2 = t2.replace(/\(Санкт-Петербург\)/g, '');
      t2 = t2.replace(/\(СДО\)/g, '');
      t2 = t2.replace(/\(онлайн\)/gi, '');
      t2 = t2.replace(/Договор\s*№\s*\d+(\s+от\s+\d{2}\.\d{2}\.\d{4})?/g, '');
      t2 = t2.replace(/от\s+/g, '');
      t2 = t2.replace(/\d{2}\.\d{2}-/g, '');
      t2 = t2.replace(/-\s*\d{2}\.\d{2}$/g, '');
      t2 = t2.replace(/^\d{2}\.\d{2}\s*/g, '');
      t2 = t2.replace(/\s+\d{2}$/g, '');
      t2 = t2.replace(/\s+\d{2}\s/g, ' ');
      t2 = t2.replace(/\s+/g, ' ').trim().replace(/[ ,.\-;:\t\n]+$/g, '');
      return t2.length > 3 ? t2 : t;
    }

    const main = [];
    const ilp = [];
    const corp = [];
    
    for (const r of data) {
      const napr = r[19] || '';
      const title = r[1] || '';
      if (napr === 'Корпоративное обучение') {
        corp.push(r);
      } else if (title.trim().toUpperCase().startsWith('ILP') || title.includes(' ILP ')) {
        ilp.push(r);
      } else {
        main.push(r);
      }
    }

    function groupProducts(arr) {
      const map = {};
      for (const r of arr) {
        const name = cleanTitle(r[1] || '');
        const summa = parseFloat(r[5]) || 0;
        const fmt = r[18] || '';
        const naprV = r[19] || '';
        if (!map[name]) map[name] = { cnt: 0, rev: 0, formats: {}, napravleniya: new Set() };
        map[name].cnt++;
        map[name].rev += summa;
        map[name].formats[fmt] = (map[name].formats[fmt] || 0) + 1;
        map[name].napravleniya.add(naprV);
      }
      return Object.entries(map)
        .map(([k,v]) => ({ name: k, cnt: v.cnt, rev: Math.round(v.rev), formats: v.formats, napr: [...v.napravleniya].filter(Boolean).join(', ') }))
        .sort((a,b) => b.cnt - a.cnt || b.rev - a.rev);
    }

    const mainRanking = groupProducts(main);
    const mainByRev = [...mainRanking].sort((a,b) => b.rev - a.rev || b.cnt - a.cnt);
    const ilpRanking = groupProducts(ilp);
    const corpRanking = groupProducts(corp);

    res.json({
      total_all: data.length,
      main: { count: main.length, revenue: Math.round(main.reduce((s,r) => s + (parseFloat(r[5])||0), 0)), itemsByCnt: mainRanking.slice(0,20), itemsByRev: mainByRev.slice(0,20) },
      ilp: { count: ilp.length, revenue: Math.round(ilp.reduce((s,r) => s + (parseFloat(r[5])||0), 0)), items: ilpRanking },
      corp: { count: corp.length, revenue: Math.round(corp.reduce((s,r) => s + (parseFloat(r[5])||0), 0)), items: corpRanking }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============== API: Roistat + Bitrix24 funnel ==============
app.get('/api/roistat-funnel', (req, res) => {
  try {
    const cachePath = '/tmp/roistat_b24_match.json';
    if (fs.existsSync(cachePath)) {
      const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      return res.json(data);
    }
    res.json({ error: 'No cache. Run match_roistat_b24.py first.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============== API: Bitrix24 ==============
app.get('/api/bitrix-deals', async (req, res) => {
  try {
    // Batch all category counts
    const results = {};
    const categories = [
      { id: '0', name: 'sale' },
      { id: '8', name: 'pre_sale' },
      { id: '19', name: 'kom' }
    ];
    for (const cat of categories) {
      const totalRes = await fetchUrl(
        `${BITRIX_WEBHOOK}/crm.deal.list?filter[CATEGORY_ID]=${cat.id}&filter[>=DATE_CREATE]=2026-05-01&filter[<DATE_CREATE]=2026-06-01&limit=1`
      );
      const total = totalRes.total || 0;
      
      const wonRes = await fetchUrl(
        `${BITRIX_WEBHOOK}/crm.deal.list?filter[CATEGORY_ID]=${cat.id}&filter[>=DATE_CREATE]=2026-05-01&filter[<DATE_CREATE]=2026-06-01&filter[STAGE_SEMANTIC_ID]=S&limit=1`
      );
      const won = wonRes.total || 0;
      
      const wonPosRes = await fetchUrl(
        `${BITRIX_WEBHOOK}/crm.deal.list?filter[CATEGORY_ID]=${cat.id}&filter[>=DATE_CREATE]=2026-05-01&filter[<DATE_CREATE]=2026-06-01&filter[STAGE_SEMANTIC_ID]=S&filter[>OPPORTUNITY]=0&limit=1`
      );
      const wonPositive = wonPosRes.total || 0;
      
      const wonZeroRes = await fetchUrl(
        `${BITRIX_WEBHOOK}/crm.deal.list?filter[CATEGORY_ID]=${cat.id}&filter[>=DATE_CREATE]=2026-05-01&filter[<DATE_CREATE]=2026-06-01&filter[STAGE_SEMANTIC_ID]=S&filter[OPPORTUNITY]=0&limit=1`
      );
      const wonZero = wonZeroRes.total || 0;

      const loseRes = await fetchUrl(
        `${BITRIX_WEBHOOK}/crm.deal.list?filter[CATEGORY_ID]=${cat.id}&filter[>=DATE_CREATE]=2026-05-01&filter[<DATE_CREATE]=2026-06-01&filter[STAGE_SEMANTIC_ID]=F&limit=1`
      );
      const lose = loseRes.total || 0;

      const inProgRes = await fetchUrl(
        `${BITRIX_WEBHOOK}/crm.deal.list?filter[CATEGORY_ID]=${cat.id}&filter[>=DATE_CREATE]=2026-05-01&filter[<DATE_CREATE]=2026-06-01&filter[STAGE_SEMANTIC_ID]=P&limit=1`
      );
      const inProg = inProgRes.total || 0;

      // Revenue for WON positive deals
      let revenue = 0;
      if (wonPositive > 0) {
        const revRes = await fetchUrl(
          `${BITRIX_WEBHOOK}/crm.deal.list?filter[CATEGORY_ID]=${cat.id}&filter[>=DATE_CREATE]=2026-05-01&filter[<DATE_CREATE]=2026-06-01&filter[STAGE_SEMANTIC_ID]=S&filter[>OPPORTUNITY]=0&select[]=ID&select[]=OPPORTUNITY&limit=50`
        );
        if (revRes.result) {
          revenue = revRes.result.reduce((sum, d) => sum + (parseFloat(d.OPPORTUNITY) || 0), 0);
          // If more than 50, estimate
          if (revRes.total > 50 && revRes.result.length > 0) {
            const avg = revenue / revRes.result.length;
            revenue = avg * wonPositive;
          }
        }
      }

      results[cat.name] = {
        total_all: total,
        won,
        won_positive: wonPositive,
        won_zero: wonZero,
        lose,
        in_progress: inProg,
        revenue: Math.round(revenue)
      };
    }
    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============== FRONTEND ==============
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'web-interface', 'public', 'test-dashboard.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'web-interface', 'public', 'test-dashboard.html'));
});

export default app;

// Прямой запуск
const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] === thisFile) {
  app.listen(PORT, '0.0.0.0', () => console.log(`🍀 Тест-дашборд на http://0.0.0.0:${PORT}`));
}
