/**
 * test-dashboard/server.js — «Тестовый дашборд (прогноз)» (sub-app). В РАЗРАБОТКЕ.
 *
 * ЗАЧЕМ: песочница для прогноза продаж и интеграций внешней аналитики.
 * ЧТО ДЕЛАЕТ (API): Яндекс.Метрика (/api/metrika-*), Roistat (/api/roistat-*),
 *   Bitrix (/api/bitrix-deals), планы (/api/plans GET/POST), расчёт мотивации
 *   (/api/motivation-calc), рейтинг продуктов, выгрузка анализа. catch-all → index.html.
 * ВНИМАНИЕ: ходит во ВНЕШНИЕ сервисы (Метрика/Roistat), не только в getAgg().
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import https from 'https';
import fs from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { getAgg, getCacheAt } from '@rshu/data-service/agg-cache.js';
// Единые бизнес-правила (КОМ-признак, воронки, отчётный год)
import { isKomDeal, VALID_CATS, YEAR } from '@rshu/data-service/lib/deal-rules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DS_CACHE = path.resolve(__dirname, '../../data-service/cache');
const PLANS_FILE = path.join(__dirname, 'data', 'plans.json');

const MONTH_NAMES = { '01':'Январь','02':'Февраль','03':'Март','04':'Апрель','05':'Май','06':'Июнь','07':'Июль','08':'Август','09':'Сентябрь','10':'Октябрь','11':'Ноябрь','12':'Декабрь' };

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

const BITRIX_WEBHOOK = 'https://24.uprav.ru/rest/516/k1cdomfp4vd1kiql';

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
    
    const mayCalls = calls.filter(c => (c.date || '').startsWith('2026-05'));
    const mayAnswered = mayCalls.filter(c => (parseInt(c.duration)||0) > 0);
    const mayCallers = new Set(mayCalls.map(c => c.caller).filter(Boolean));
    const mayDuration = mayAnswered.reduce((s,c) => s + (parseInt(c.duration)||0), 0);

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
    const xlsDir = '/root/.openclaw/media/inbound/';
    let xlsPath = null;
    if (fs.existsSync(xlsDir)) {
      const files = fs.readdirSync(xlsDir).filter(f => f.startsWith('выгрузка_') && (f.endsWith('.xls') || f.endsWith('.xlsx')));
      if (files.length > 0) xlsPath = path.join(xlsDir, files.sort().reverse()[0]);
    }
    if (!xlsPath || !fs.existsSync(xlsPath)) {
      return res.json({ error: 'Файл выгрузки не найден. Подложите выгрузку из Bitrix24 в /root/.openclaw/media/inbound/' });
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

// ============== API: Анализ источников/форматов по менеджерам ==============
const OUTGOING_SOURCE_IDS = new Set([
  '79641902894', // Аккаунтинг
  'UC_7G65N9',   // Реанимация
  '79641902977', // RepeatSale
  'REPEAT_SALE',
  '79641902926', // Upsale
  '79641902903', // Очная/Холодная база
  'UC_0QUMRZ',   // Out Sale
]);

app.get('/api/export-analysis', async (req, res) => {
  try {
    const [dealsRaw, dictsRaw] = await Promise.all([
      readFile(path.join(DS_CACHE, 'deals.json'), 'utf-8'),
      readFile(path.join(DS_CACHE, 'dicts.json'), 'utf-8'),
    ]);
    const deals = JSON.parse(dealsRaw);
    const dicts = JSON.parse(dictsRaw);
    const users   = dicts.users   || {};
    const sources = dicts.sources || {};

    // { "<год>-01": { mgrId: { incoming, outgoing, kom, other, sources: { srcName: amount } } } }
    const byMonthMgr = {};

    for (const d of deals) {
      if (!VALID_CATS.has(parseInt(d.CATEGORY_ID || 0))) continue;
      if (d.STAGE_SEMANTIC_ID !== 'S' || d.CLOSED !== 'Y') continue;
      if (!d.UF_DATE_PAY_1C) continue;
      const payDate = new Date(d.UF_DATE_PAY_1C.substring(0, 10));
      if (payDate.getFullYear() !== YEAR) continue;

      const monthKey = `${YEAR}-${String(payDate.getMonth() + 1).padStart(2, '0')}`;
      const mgrId    = String(d.ASSIGNED_BY_ID || '');
      const amount   = parseFloat(d.OPPORTUNITY || 0);
      const srcId    = String(d.SOURCE_ID || '');
      const srcName  = sources[srcId] || srcId || 'Не указан';
      const isKom    = isKomDeal(d);
      const isOut    = OUTGOING_SOURCE_IDS.has(srcId);

      if (!byMonthMgr[monthKey]) byMonthMgr[monthKey] = {};
      if (!byMonthMgr[monthKey][mgrId]) byMonthMgr[monthKey][mgrId] = { incoming: 0, outgoing: 0, kom: 0, other: 0, sources: {} };

      const m = byMonthMgr[monthKey][mgrId];
      if (isKom)       m.kom      += amount;
      else if (isOut)  m.outgoing += amount;
      else             m.incoming += amount;
      m.other = m.kom; // для совместимости с фронтом (other = KOM, остальное = ООМ/ОМ)
      m.sources[srcName] = (m.sources[srcName] || 0) + amount;
    }

    // Собираем результат в формате { "2026-01": { managers: [...], total_* } }
    const result = {};
    for (const [monthKey, mgrMap] of Object.entries(byMonthMgr)) {
      const managers = Object.entries(mgrMap)
        .map(([id, v]) => ({
          name: users[id] || `ID:${id}`,
          incoming: Math.round(v.incoming),
          outgoing: Math.round(v.outgoing),
          kom:      Math.round(v.kom),
          other:    Math.round(v.kom),
          total:    Math.round(v.incoming + v.outgoing + v.kom),
          sources:  Object.entries(v.sources)
            .map(([name, amount]) => ({ name, amount: Math.round(amount) }))
            .sort((a, b) => b.amount - a.amount),
        }))
        .filter(m => m.total > 0)
        .sort((a, b) => b.total - a.total);

      result[monthKey] = {
        month: monthKey,
        managers,
        total_incoming: managers.reduce((s, m) => s + m.incoming, 0),
        total_outgoing: managers.reduce((s, m) => s + m.outgoing, 0),
        total_kom:      managers.reduce((s, m) => s + m.kom, 0),
        total_other:    managers.reduce((s, m) => s + m.kom, 0),
        total_all:      managers.reduce((s, m) => s + m.total, 0),
      };
    }

    res.json(result);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ============== API: Bitrix24 ==============
app.get('/api/bitrix-deals', async (req, res) => {
  try {
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

      let revenue = 0;
      if (wonPositive > 0) {
        const revRes = await fetchUrl(
          `${BITRIX_WEBHOOK}/crm.deal.list?filter[CATEGORY_ID]=${cat.id}&filter[>=DATE_CREATE]=2026-05-01&filter[<DATE_CREATE]=2026-06-01&filter[STAGE_SEMANTIC_ID]=S&filter[>OPPORTUNITY]=0&select[]=ID&select[]=OPPORTUNITY&limit=50`
        );
        if (revRes.result) {
          revenue = revRes.result.reduce((sum, d) => sum + (parseFloat(d.OPPORTUNITY) || 0), 0);
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

// ============== API: Планы мотивации ==============

app.get('/api/plans', async (req, res) => {
  try {
    const data = JSON.parse(await readFile(PLANS_FILE, 'utf-8').catch(() => '{}'));
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/plans', async (req, res) => {
  try {
    await writeFile(PLANS_FILE, JSON.stringify(req.body, null, 2), 'utf-8');
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Факт по менеджерам помесячно из deals.json + планы из plans.json
app.get('/api/motivation-calc', async (req, res) => {
  try {
    const [dealsRaw, dictsRaw, plansRaw] = await Promise.all([
      readFile(path.join(DS_CACHE, 'deals.json'), 'utf-8'),
      readFile(path.join(DS_CACHE, 'dicts.json'), 'utf-8'),
      readFile(PLANS_FILE, 'utf-8').catch(() => '{}'),
    ]);

    const deals = JSON.parse(dealsRaw);
    const users = JSON.parse(dictsRaw).users || {};
    const plans = JSON.parse(plansRaw);

    // Факт: WON-сделки, группируем по менеджеру + месяц оплаты (UF_DATE_PAY_1C)
    const byMgrMonth = {};
    for (const d of deals) {
      if (!VALID_CATS.has(parseInt(d.CATEGORY_ID || 0))) continue;
      if (d.STAGE_SEMANTIC_ID !== 'S' || d.CLOSED !== 'Y') continue;
      if (!d.UF_DATE_PAY_1C) continue;
      const payDate = new Date(d.UF_DATE_PAY_1C.substring(0, 10));
      if (payDate.getFullYear() !== YEAR) continue;
      const monthKey = `${YEAR}-${String(payDate.getMonth() + 1).padStart(2, '0')}`;
      const mgrId = String(d.ASSIGNED_BY_ID || '');
      if (!byMgrMonth[mgrId]) byMgrMonth[mgrId] = {};
      byMgrMonth[mgrId][monthKey] = (byMgrMonth[mgrId][monthKey] || 0) + parseFloat(d.OPPORTUNITY || 0);
    }

    // Список месяцев с начала года до текущего
    const today = new Date();
    const months = [];
    for (let m = 1; m <= Math.min(today.getMonth() + 1, 12); m++) {
      months.push(`${YEAR}-${String(m).padStart(2, '0')}`);
    }

    const result = months.map(monthKey => {
      const mm = monthKey.split('-')[1];
      const managers = Object.entries(users)
        .map(([id, name]) => {
          const fact  = Math.round(byMgrMonth[id]?.[monthKey] || 0);
          const entry = plans[id]?.[monthKey] || {};
          const plan      = entry.plan      || 0;
          const bonus_pct = entry.bonus_pct || 0;
          const pct  = plan > 0 ? +(fact / plan * 100).toFixed(1) : 0;
          const itog = Math.round(fact * bonus_pct / 100);
          return { id, name, fact, plan, bonus_pct, pct, itog };
        })
        .filter(m => m.fact > 0 || m.plan > 0)
        .sort((a, b) => b.fact - a.fact);

      const total = managers.reduce(
        (t, m) => ({ fact: t.fact + m.fact, plan: t.plan + m.plan, itog: t.itog + m.itog }),
        { fact: 0, plan: 0, itog: 0 }
      );
      total.pct = total.plan > 0 ? +(total.fact / total.plan * 100).toFixed(1) : 0;

      return { month: monthKey, month_label: `${MONTH_NAMES[mm]} ${YEAR}`, managers, total };
    });

    res.json(result);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ============== API: Новая логика ==============
app.get('/api/data/new', async (req, res) => {
  try {
    const data = await getAgg();
    res.json(Object.assign({}, data, { _loadedAt: data.fetched_at || new Date(getCacheAt()).toISOString() }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============== FRONTEND ==============

app.get('/*', (req, res) => {
  if (path.extname(req.path)) return res.status(404).end();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

export default app;

// Прямой запуск (для отладки)
const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] === thisFile) {
  app.listen(3004, '0.0.0.0', () => console.log(`🍀 Тест-дашборд на http://0.0.0.0:3004`));
}
