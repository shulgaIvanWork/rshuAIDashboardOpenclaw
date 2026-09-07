/**
 * portfolio-flow.js — Sankey «Движение портфеля» (drop-dashboard, вкладка «Воронка продаж»).
 *
 * Схема: Остаток на начало + Создано в периоде → Всего доступно в работе
 *        → Оплачено / Отказано / Остаток на конец
 *        → (справа, при наличии состояния на to) разбивка остатка по этапам:
 *          до MQL / MQL / SQL / Счёт.
 *
 * ПРАВИЛА (согласованы 04.09.2026):
 *   - портфель: ТОЛЬКО кат.0 (воронка Sale). КОМ (кат.19) и PreSale (кат.8) НЕ входят —
 *     у тех воронок другие этапы (разбивка остатка по этапам — Sale-логика);
 *   - «технические» WON (sem S, сумма < MIN_OPP) исключены везде;
 *   - WON без даты оплаты 1С (sem S и нет UF_DATE_PAY_1C) — вне Sankey
 *     (артефакт won_no_pay), считаются в meta;
 *   - «Оплачено» = UF_DATE_PAY_1C ∈ периоду и сумма ≥ MIN_OPP. Приоритет над
 *     отказом: возврат (оплата + отказ в периоде) → только «Оплачено»;
 *   - «Отказано» = стадия LOSE и эффективная дата отказа ∈ периоду.
 *     Эффективная дата отказа = UF_CRM_1753341391806, если заполнена;
 *     иначе CLOSEDATE (в 2025 дату отказа не заполняли — закрывали стадией,
 *     CLOSEDATE есть у всех LOSE). Это исключает «мёртвые души» из остатков:
 *     сделка, закрытая до периода, не тащится хвостом;
 *   - ТЕХНИЧЕСКИЕ ЗАЧИСТКИ (массовое закрытие старого хвоста, напр. 24.08.2026 — 244 шт):
 *     LOSE, закрытая в день, когда всего (кат.0, вся база) закрыто > 30 LOSE,
 *     и возраст сделки на момент закрытия > 180 дней → исключается из портфеля
 *     целиком (не в остатках, не в «Отказано»), счётчик — meta.tech_purge;
 *   - «В работе» на дату D = создана ≤ D, не оплачена ≤ D (1С ≥ MIN_OPP),
 *     не отказана ≤ D (эффективная дата), не WON-без-1С, не тех. зачистка;
 *   - одна сделка — ровно в одном исходе: paid > refused > end (приоритет);
 *   - аномалии (создана в периоде, но закрыта до from — даты противоречивы;
 *     событие в периоде без втекания — «возвращены в работу») — единичны,
 *     возвращённые показываются отдельным потоком, противоречивые — в meta.ignored.
 *
 * РАЗБИВКА ОСТАТКА ПО ЭТАПАМ (endBreakdown):
 *   Показывается всегда (хвост фиксируется как состояние на конец периода):
 *   - есть ежедневный снапшот на to (cache/snapshots/YYYY-MM-DD.json)
 *     → стадии из снапшота (source 'snapshot:YYYY-MM-DD') — достоверно;
 *   - иначе текущие стадии из deals.json: to == дата выгрузки → 'current'
 *     (точно); прошлые to → 'approx' — ПРИБЛИЖЕНИЕ (стадии могли поменяться
 *     после конца периода; точность появится по мере накопления снапшотов).
 *   Классификация этапа — по стадии сделки (воронка Sale, кат.0):
 *     «Счёт» = PROPOSAL/6(частично оплачен)/2(постоплата); SQL = DETAILS;
 *     MQL = стадии MQL+; «до MQL» — исходные и служебные (без сумм);
 *     «Следующий год» (UC_W6SCHG) — отдельная категория (отложенные).
 */

// ── Стадии ────────────────────────────────────────────────────────────────────
// «Счёт» в разбивке остатка разбит на три стадии (решение 04.09.2026):
//   PROPOSAL «Счёт отправлен» · 6 «Частичная оплата» · 2 «Постоплата»
const INV_PROPOSAL = new Set(['PROPOSAL']);
const INV_PARTIAL = new Set(['6']);
const INV_POSTPAY = new Set(['2']);
const SQL_SALE = new Set(['DETAILS']);                        // SQL-стадия кат.0
const MQL_SALE = new Set(['UC_4RJOR4', 'DETAILS', 'PROPOSAL', '2', '6', 'WON', 'LOSE',
  'UC_F2YC3N', 'UC_VKPN0N', 'UC_W6SCHG', 'UC_670ME2']);
// «до MQL»: исходные и служебные метки без квалификации/сумм
const NOT_MQL = new Set(['NEW', 'UC_1YW3V2', 'UC_STZB49', 'UC_838R2R', 'UC_VKPN0N', 'UC_670ME2']);
// «Следующий год» (UC_W6SCHG) — НЕ MQL: отложенные квалифицированные сделки с суммой
// (общие правила на этом срезе не работают — отдельная категория разбивки)
const DEFERRED = new Set(['UC_W6SCHG']);

import { MIN_OPP } from './deal-rules.js';

function parseDt(s) {
  if (!s) return null;
  let m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = String(s).match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  return null;
}
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Этап по стадии (для разбивки остатка). Только воронка Sale (кат.0).
 *  stage — без префикса C<id>:
 *  pre_mql «до MQL» · mql · sql · inv_proposal «Счёт отправлен» ·
 *  inv_partial «Частичная оплата» · inv_postpay «Постоплата» · deferred «Следующий год» */
export function classifyEndStage(cat, stage, sem) {
  if (cat === '0') {
    if (DEFERRED.has(stage)) return 'deferred';              // «Следующий год» — отложка, не MQL
    if (INV_PROPOSAL.has(stage)) return 'inv_proposal';      // Счёт отправлен
    if (INV_PARTIAL.has(stage)) return 'inv_partial';        // Частичная оплата
    if (INV_POSTPAY.has(stage)) return 'inv_postpay';        // Постоплата
    if (SQL_SALE.has(stage)) return 'sql';
    if (MQL_SALE.has(stage) && !NOT_MQL.has(stage)) return 'mql';
    return 'pre_mql';
  }
  return 'pre_mql'; // другие категории в Sale-портфель не входят
}

/**
 * Главный расчёт движения портфеля.
 * dealsRaw — массив сделок из cache/deals.json.
 * opts: { from, to: Date; mgrId: string|null; asOf: Date|null (дата выгрузки);
 *        snapshot: array|null — записи снапшота на to (если to в прошлом) }
 */
export function computePortfolioFlow(dealsRaw, { from, to, mgrId = null, asOf = null, snapshot = null } = {}) {
  const seen = new Set();
  const meta = { tech_won: { cnt: 0 }, won_no_pay: { cnt: 0 }, ignored: { cnt: 0, sum: 0 }, tech_purge: { cnt: 0, sum: 0 } };

  // ── Тех. зачистки: пиковые дни массового закрытия LOSE по всей базе кат.0 ──
  // (закрыто > 30 LOSE за день И возраст сделки > 180 дней на момент закрытия)
  const seenD = new Set();
  const closesByDay = {};
  for (const x of dealsRaw) {
    const id = String(x.ID);
    if (!id || seenD.has(id)) continue;
    seenD.add(id);
    if (String(x.CATEGORY_ID || '') !== '0') continue;
    if ((x.STAGE_SEMANTIC_ID || '') !== 'F') continue;
    const eff = parseDt(x.UF_CRM_1753341391806) || parseDt(x.CLOSEDATE);
    if (!eff) continue;
    const k = iso(eff);
    closesByDay[k] = (closesByDay[k] || 0) + 1;
  }
  const PURGE_DAYS = new Set(Object.entries(closesByDay).filter(([, n]) => n > 30).map(([d]) => d));

  const isPurge = (x) => {
    if ((x.STAGE_SEMANTIC_ID || '') !== 'F') return false;
    const eff = parseDt(x.UF_CRM_1753341391806) || parseDt(x.CLOSEDATE);
    const dc = parseDt(x.DATE_CREATE);
    if (!eff || !dc) return false;
    if (!PURGE_DAYS.has(iso(eff))) return false;
    return (eff - dc) / 86400000 > 180; // возраст на момент закрытия
  };


  // Накопители узлов и потоков
  const N = () => ({ cnt: 0, sum: 0 });
  const nodes = { start: N(), created: N(), reopened: N(), available: N(), paid: N(), refused: N(), end: N() };
  const flows = {}; // 'start→available' и т.п. → {cnt,sum}
  const addFlow = (a, b, cnt, sum) => {
    const k = a + '→' + b;
    flows[k] = flows[k] || N();
    flows[k].cnt += cnt; flows[k].sum += sum;
  };

  const endIds = new Set(); // deal_id «в работе на to» (для разбивки)

  for (const x of dealsRaw) {
    const id = String(x.ID);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (String(x.CATEGORY_ID || '') !== '0') continue;   // только воронка Sale
    if (mgrId && String(x.ASSIGNED_BY_ID || '') !== mgrId) continue;
    const sem = x.STAGE_SEMANTIC_ID || '';
    const stage = String(x.STAGE_ID || '').replace(/^C\d+:/, '');
    const opp = parseFloat(x.OPPORTUNITY || 0);
    if (sem === 'S' && opp < MIN_OPP) { meta.tech_won.cnt++; continue; }   // технические WON
    const pay = parseDt(x.UF_DATE_PAY_1C);
    if (sem === 'S' && !pay) { meta.won_no_pay.cnt++; continue; }          // WON без 1С — вне портфеля
    if (isPurge(x)) { meta.tech_purge.cnt++; meta.tech_purge.sum += opp; continue; } // массовая зачистка хвоста
    const dc = parseDt(x.DATE_CREATE);
    if (!dc) continue;

    const refuseDt = parseDt(x.UF_CRM_1753341391806);
    const effRefuse = refuseDt || (sem === 'F' ? parseDt(x.CLOSEDATE) : null); // CLOSEDATE-fallback для LOSE

    // Битая дата отказа (в будущем относительно выгрузки, напр. 2045) — аномалия данных
    if (sem === 'F' && effRefuse && asOf && effRefuse > asOf) {
      meta.ignored.cnt++; meta.ignored.sum += opp;
      continue;
    }

    const paidE = !!(pay && opp >= MIN_OPP && pay >= from && pay <= to);      // оплата в периоде
    const refusedE = !!(sem === 'F' && effRefuse && effRefuse >= from && effRefuse <= to);

    // Втекание
    const closedBeforeFrom = (pay && pay < from) || (effRefuse && effRefuse < from);
    const inStart = !!dc && dc < from && !closedBeforeFrom;   // «в работе» на from
    const inCreated = !!dc && dc >= from && dc <= to;         // создана в периоде

    let bucket = null; // куда втекает: start | created | reopened
    if (inStart) bucket = 'start';
    else if (inCreated) {
      if (closedBeforeFrom) { meta.ignored.cnt++; meta.ignored.sum += opp; continue; } // аномалия: закрыта до from
      bucket = 'created';
    } else if (paidE || refusedE) {
      bucket = 'reopened'; // событие без втекания (возврат в работу после закрытия до from)
    } else {
      continue; // создана после to и без событий в периоде — вне портфеля
    }

    // Исход (приоритет: Оплачено > Отказано > Остаток на конец)
    let out;
    if (paidE) out = 'paid';
    else if (refusedE) out = 'refused';
    else out = 'end';

    const b = nodes[bucket]; b.cnt++; b.sum += opp;
    const o = nodes[out]; o.cnt++; o.sum += opp;
    addFlow(bucket, 'available', 1, opp);
    addFlow('available', out, 1, opp);
    if (out === 'end') endIds.add(id);
  }

  nodes.available.cnt = nodes.start.cnt + nodes.created.cnt + nodes.reopened.cnt;
  nodes.available.sum = nodes.start.sum + nodes.created.sum + nodes.reopened.sum;

  // ── Разбивка остатка на конец по этапам ────────────────────────────────
  // Состояние стадий на дату to:
  //   - снапшот на to (если to в прошлом и снимок накоплен) — достоверно;
  //   - иначе текущие стадии из кэша: для to == даты выгрузки это «текущее
  //     состояние» (точно); для прошлых to — ПРИБЛИЖЕНИЕ состояния на конец
  //     периода (стадии могли поменяться после to) — помечается 'approx'.
  let endBreakdown = null;
  let breakdownSource = null;
  const byId = {};
  if (snapshot && Array.isArray(snapshot) && snapshot.length) {
    // to в прошлом → состояние из ежедневного снапшота на to (по мере накопления)
    for (const r of snapshot) byId[String(r.id ?? r.deal_id)] = r;
    breakdownSource = 'snapshot:' + iso(to);
  } else if (asOf) {
    // текущие стадии из кэша (это и есть «снапшот сегодня»)
    for (const x of dealsRaw) byId[String(x.ID)] = x;
    breakdownSource = iso(to) === iso(asOf) ? 'current' : 'approx';
  }

  if (breakdownSource) {
    const seg = { pre_mql: N(), mql: N(), sql: N(), inv_proposal: N(), inv_partial: N(), inv_postpay: N(), deferred: N(), paid_after: N(), refused_after: N() };
    for (const id of endIds) {
      const rec = byId[id];
      if (!rec) continue; // в состоянии на to сделки нет (даты менялись) — не классифицируем
      const rcat = String(rec.CATEGORY_ID ?? rec.category_id ?? '');
      const rstage = String(rec.STAGE_ID ?? rec.stage_id ?? '').replace(/^C\d+:/, '');
      const rsem = String(rec.STAGE_SEMANTIC_ID ?? rec.stage_semantic_id ?? '');
      // Сделки остатка, закрывшиеся ПОСЛЕ конца периода (сейчас LOSE/WON), — их этап
      // на to невосстановим; в приближении показываем их отдельными сегментами
      let key;
      if (rsem === 'F') key = 'refused_after';
      else if (rsem === 'S') key = 'paid_after';
      else key = classifyEndStage('0', rstage, rsem);
      seg[key].cnt++;
      seg[key].sum += parseFloat(rec.OPPORTUNITY ?? rec.opportunity ?? 0);
    }
    // При 'current' endIds и byId — из одного кэша, расхождений нет; при снапшоте
    // возможны мелкие отличия (даты правили) — классифицируем по фактическим записям.
    const filtered = [
      { key: 'pre_mql', label: 'до MQL', cnt: seg.pre_mql.cnt, sum: Math.round(seg.pre_mql.sum) },
      { key: 'mql', label: 'MQL', cnt: seg.mql.cnt, sum: Math.round(seg.mql.sum) },
      { key: 'sql', label: 'SQL', cnt: seg.sql.cnt, sum: Math.round(seg.sql.sum) },
      { key: 'inv_proposal', label: 'Счёт отправлен', cnt: seg.inv_proposal.cnt, sum: Math.round(seg.inv_proposal.sum) },
      { key: 'inv_partial', label: 'Частичная оплата', cnt: seg.inv_partial.cnt, sum: Math.round(seg.inv_partial.sum) },
      { key: 'inv_postpay', label: 'Постоплата', cnt: seg.inv_postpay.cnt, sum: Math.round(seg.inv_postpay.sum) },
      { key: 'deferred', label: 'Следующий год', cnt: seg.deferred.cnt, sum: Math.round(seg.deferred.sum) },
      { key: 'paid_after', label: 'Оплачены после периода', cnt: seg.paid_after.cnt, sum: Math.round(seg.paid_after.sum) },
      { key: 'refused_after', label: 'Отказаны после периода', cnt: seg.refused_after.cnt, sum: Math.round(seg.refused_after.sum) },
    ].filter(s => s.cnt > 0);
    endBreakdown = filtered.length ? filtered : null;
  }

  return {
    period: { from: iso(from), to: iso(to) },
    mgr: mgrId,
    nodes: {
      start: { cnt: nodes.start.cnt, sum: Math.round(nodes.start.sum) },
      created: { cnt: nodes.created.cnt, sum: Math.round(nodes.created.sum) },
      reopened: { cnt: nodes.reopened.cnt, sum: Math.round(nodes.reopened.sum) },
      available: { cnt: nodes.available.cnt, sum: Math.round(nodes.available.sum) },
      paid: { cnt: nodes.paid.cnt, sum: Math.round(nodes.paid.sum) },
      refused: { cnt: nodes.refused.cnt, sum: Math.round(nodes.refused.sum) },
      end: { cnt: nodes.end.cnt, sum: Math.round(nodes.end.sum) },
    },
    flows: Object.entries(flows).map(([k, v]) => {
      const [a, b] = k.split('→');
      return { from: a, to: b, cnt: v.cnt, sum: Math.round(v.sum) };
    }),
    endBreakdown,
    breakdownSource,
    meta: {
      tech_won: meta.tech_won.cnt,
      won_no_pay: meta.won_no_pay.cnt,
      tech_purge: { cnt: meta.tech_purge.cnt, sum: Math.round(meta.tech_purge.sum) },
      ignored: { cnt: meta.ignored.cnt, sum: Math.round(meta.ignored.sum) },
    },
  };
}

// Стадия может прийти из снапшота с полем category_id; для 'current' в byId лежат
// полные записи deals с CATEGORY_ID. Категория берётся из записи, при отсутствии
// трактуется как кат.0.
