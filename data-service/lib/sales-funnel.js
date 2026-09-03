/**
 * sales-funnel.js — когортная воронка продаж «Создано → MQL → SQL → Счёт → Оплата».
 *
 * ЗАЧЕМ:
 *   Вкладка «Воронка продаж» (drop-dashboard). Когорта = сделки, СОЗДАННЫЕ в выбранном
 *   периоде (DATE_CREATE). Дедупликация по ID. Для каждой сделки определяется
 *   МАКСИМАЛЬНЫЙ ВОССТАНОВИМЫЙ этап — из текущего/финального состояния + фактов-дат.
 *
 * ОГРАНИЧЕНИЕ (осознанное, показывается на дашборде):
 *   В выгрузке НЕТ истории переходов по стадиям. Поэтому:
 *   - MQL/SQL восстанавливаются только по ТЕКУЩЕЙ стадии (открытые сделки — надёжно;
 *     закрытые WON — надёжно);
 *   - закрытые отказом (SEM=F) к MQL/SQL НЕ приписываются (стадия «LOSE» общая, пик
 *     неизвестен) — они остаются на «Создано» и считаются отдельно (lose_unknown);
 *   - «технические» WON (успех с суммой < MIN_OPP, создаются ботом) исключаются
 *     из когорты полностью (tech_won).
 *
 * НАКОПИТЕЛЬНОСТЬ (главный инвариант):
 *   Сделка, достигшая поздней ступени, учитывается во ВСЕХ предыдущих — перенос
 *   в «Счёт»/«Оплачено» НЕ исключает её из SQL/MQL/«Создано»:
 *   created >= mql >= sql >= invoice >= paid. Ступени считаются по формулам
 *   (не max-этапом, не взаимоисключающе):
 *     paid  = факт оплаты 1С (>= MIN_OPP);
 *     inv   = дата счёта ИЛИ стадия PROPOSAL/6/2 ИЛИ paid;
 *     sql   = стадия DETAILS/PROPOSAL/6/2 (кат.0) ИЛИ inv;  → SQL «не худеет»;
 *     mql   = стадия MQL+ ИЛИ sql.
 *   WON без даты оплаты 1С НЕ попадает ни в «Счёт», ни в «Оплачено» — это артефакт
 *   (won_no_pay); ступень по WON-стадии не присваивается.
 *
 * ПРАВИЛА ЭТАПОВ (единые с deal-rules / управленческим дашбордом):
 *   - paid  : ТОЛЬКО фактическая оплата UF_DATE_PAY_1C при сумме >= MIN_OPP (дата оплаты
 *             может быть позже выбранного периода — считается факт по сделке когорты);
 *   - invoice: дата «Счёт отправлен» (UF_CRM_1753272713011) ИЛИ стадия счёта для кат.0
 *             (PROPOSAL «Счёт отправлен» / 6 «Частично оплачен» / 2 «Постоплата»)
 *             ИЛИ фактическая оплата;
 *   - sql   : кат.0 — DETAILS + PROPOSAL + 6 + 2 (общая формула); кат.19 (КОМ) —
 *             EXECUTING/UC_C670BC/UC_I443UQ; ИЛИ invoice;
 *   - mql   : кат.0 — стадии MQL+ (не «исходные»); кат.19 — открытые (не S/F;
 *             первая стадия КОМ = «Квалифицирован КОМ» — уже MQL); ИЛИ sql.
 *   Для SEM=F стадии MQL/SQL/Счёт по стадии НЕ присваиваются (только факты счёта/оплаты).
 *
 * ОТДЕЛЬНО — PreSale (кат.8): воронка «Квалификации» (до передачи в отдел продаж):
 *   Создано → Взят в работу → Тёплый лид → Квалификация → Передано в ОП.
 *   PreSale НЕ входит в основную воронку продаж (это прогрев до ОП).
 */

// ── Стадии (кат.0 Sale) ────────────────────────────────────────────────────────
// SQL — по общей формуле: DETAILS («Лид для продажи SQL») + PROPOSAL («Счёт
// отправлен») + 6 («Частично оплачен») + 2 («Постоплата»). WON сюда НЕ входит:
// WON без даты оплаты 1С — артефакт, а не ступень.
const SALE_SQL_STAGES = new Set(['DETAILS', 'PROPOSAL', '6', '2']);
// «Счёт» как СЛЕДУЮЩАЯ накопительная ступень после SQL (по стадии): PROPOSAL/6/2.
const SALE_INV_STAGES = new Set(['PROPOSAL', '6', '2']);
// Категория 19 (КОМ): SQL-стадии по коду analyze.js (isSqlByCreate)
const KOM_SQL = new Set(['EXECUTING', 'UC_C670BC', 'UC_I443UQ']);
// PreSale (кат.8): порядок стадий для «Квалификации» (0 = исходные … 4 = передано в ОП)
const PRE_ORDER = {
  'NEW': 0, 'UC_L8OY62': 0, 'UC_0RNGC9': 0, 'UC_WZBRZC': 0,   // исходные / прогрев / холодные
  'UC_AMKNXY': 1, 'UC_VIEIV9': 1,                              // взят в работу / просрочен
  'PREPARATION': 2,                                             // тёплый лид
  'PREPAYMENT_INVOICE': 3,                                      // квалификация
  'WON': 4,                                                     // передано в ОП
};

const NOT_MQL_SALE = new Set(['NEW', 'UC_1YW3V2', 'UC_STZB49', 'UC_838R2R']);
const MQL_SALE_STAGES = new Set(['UC_4RJOR4', 'DETAILS', 'PROPOSAL', '2', '6', 'WON', 'LOSE',
  'UC_F2YC3N', 'UC_VKPN0N', 'UC_W6SCHG', 'UC_670ME2']);
import { MIN_OPP } from './deal-rules.js';
import { getMgrGroup } from './mgr-groups.js';

// ── Утилиты ────────────────────────────────────────────────────────────────────
function parseDt(s) {
  if (!s) return null;
  let m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = String(s).match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  return null;
}
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Главный расчёт. from/to — Date (полночь, включительно) по DATE_CREATE. */
export function computeSalesFunnel(dealsRaw, { from, to, mgrId = null, users = {} } = {}) {
  const seen = new Set();
  const allMgrIds = new Set();   // менеджеры всей когорты периода (для селекта, без mgr-фильтра)
  const cohort = [];            // все сделки когорты (кат 0/8/19, созданные в периоде)
  for (const x of dealsRaw) {
    const id = String(x.ID);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const cat = String(x.CATEGORY_ID || '');
    if (cat !== '0' && cat !== '8' && cat !== '19') continue;
    const dc = parseDt(x.DATE_CREATE);
    if (!dc || (from && dc < from) || (to && dc > to)) continue;
    if (x.ASSIGNED_BY_ID) allMgrIds.add(String(x.ASSIGNED_BY_ID));
    if (mgrId && String(x.ASSIGNED_BY_ID || '') !== mgrId) continue;
    cohort.push({
      id,
      mgr: String(x.ASSIGNED_BY_ID || ''),
      cat,
      sem: x.STAGE_SEMANTIC_ID || '',
      stage: String(x.STAGE_ID || '').replace(/^C\d+:/, ''),
      opp: parseFloat(x.OPPORTUNITY || 0),
      dc,
      payDt: parseDt(x.UF_DATE_PAY_1C),
      invDt: parseDt(x.UF_CRM_1753272713011),
      title: String(x.TITLE || ''),
    });
  }

  const name = id => users[id] || id || '(без ответственного)';

  // ── Основная воронка: кат.0 (Sale) + кат.19 (КОМ) ─────────────────────────
  const mainRows = cohort.filter(r => r.cat !== '8');
  const zeroM = () => ({ created: 0, mql: 0, sql: 0, invoice: 0, paid: 0, lose_unknown: 0, tech_won: 0 });
  const mgrM = {};
  const stageTot = { created: 0, mql: 0, sql: 0, invoice: 0, paid: 0, lose_unknown: 0, tech_won: 0 };
  const artifacts = {
    tech_won: { cnt: 0, sum: 0 },
    returns: { cnt: 0, sum: 0 },
    won_no_pay: { cnt: 0, sum: 0 },
    paid_no_inv: { cnt: 0, sum: 0 },
    paid_in_progress: { cnt: 0, sum: 0 },
    neg_dur: { cnt: 0, sum: 0 },
    lose_unknown: { cnt: 0 },
  };

  for (const r of mainRows) {
    const paid = !!(r.payDt && r.opp >= MIN_OPP);
    let loseUnknown = false;

    // «Технический» WON (бот, нулевая сумма) — исключаем из воронки целиком
    if (r.sem === 'S' && r.opp < MIN_OPP) {
      artifacts.tech_won.cnt++; artifacts.tech_won.sum += r.opp;
      const m = mgrM[r.mgr] || (mgrM[r.mgr] = zeroM());
      m.tech_won++;
      stageTot.tech_won++;
      continue;
    }

    // Этап по стадии — только если сделка не закрыта отказом (у LOSE пик неизвестен)
    let mqlStage = false, sqlStage = false, invStage = false;
    if (r.sem !== 'F') {
      if (r.cat === '0') {
        invStage = SALE_INV_STAGES.has(r.stage);                 // PROPOSAL / 6 / 2
        sqlStage = SALE_SQL_STAGES.has(r.stage);                 // DETAILS + PROPOSAL + 6 + 2
        mqlStage = !NOT_MQL_SALE.has(r.stage) && MQL_SALE_STAGES.has(r.stage);
      } else { // кат.19 (КОМ) — как в общей логике (isSqlByCreate / isQualLeadW)
        sqlStage = r.sem !== 'S' && KOM_SQL.has(r.stage);        // EXECUTING / UC_C670BC / UC_I443UQ
        mqlStage = !(r.sem === 'S' || r.sem === 'F');            // открытая КОМ = уже MQL
      }
    }

    // НАКОПИТЕЛЬНО (каждая ступень включает все предыдущие, ничего не исключая):
    //   paid → «Оплачено»: только факт оплаты 1С (>= MIN_OPP);
    //   inv  → «Счёт»: дата счёта ИЛИ стадия PROPOSAL/6/2 ИЛИ оплата;
    //   sql  → SQL: стадия DETAILS/PROPOSAL/6/2 ИЛИ «Счёт» (сделка из «Счёта» НЕ
    //          исключается из SQL);
    //   mql  → MQL: стадия MQL+ ИЛИ SQL.
    const paidF = paid;
    const invF   = !!r.invDt || invStage || paidF;
    const sqlF   = sqlStage || invF;
    const mqlF   = mqlStage || sqlF;
    if (r.sem === 'F') loseUnknown = !invF && !paidF; // нет счёта/оплаты → пик невосстановим

    // Артефакты (по когорте, с учётом менеджера)
    if (paid) {
      if (r.sem === 'F') { artifacts.returns.cnt++; artifacts.returns.sum += r.opp; }
      if (!r.invDt) { artifacts.paid_no_inv.cnt++; artifacts.paid_no_inv.sum += r.opp; }
      if (r.sem === 'P') { artifacts.paid_in_progress.cnt++; artifacts.paid_in_progress.sum += r.opp; }
      if (r.dc && r.payDt && r.payDt < r.dc) { artifacts.neg_dur.cnt++; artifacts.neg_dur.sum += r.opp; }
    } else if (r.sem === 'S' && r.cat === '0') {
      artifacts.won_no_pay.cnt++; artifacts.won_no_pay.sum += r.opp; // WON «Счёт оплачен» без даты 1С
    }
    if (loseUnknown) artifacts.lose_unknown.cnt++;

    const m = mgrM[r.mgr] || (mgrM[r.mgr] = zeroM());
    m.created++; stageTot.created++;
    if (mqlF) { m.mql++; stageTot.mql++; }
    if (sqlF) { m.sql++; stageTot.sql++; }
    if (invF) { m.invoice++; stageTot.invoice++; }
    if (paidF) { m.paid++; stageTot.paid++; }
    if (loseUnknown) { m.lose_unknown++; stageTot.lose_unknown++; }
  }

  const byManager = Object.entries(mgrM)
    .map(([id, c]) => ({ id, name: name(id), group: getMgrGroup(id), ...c }))
    .sort((a, b) => b.created - a.created || a.name.localeCompare(b.name));

  // ── PreSale (кат.8): воронка «Квалификации» ────────────────────────────────
  const preRows = cohort.filter(r => r.cat === '8');
  const zeroP = () => ({ created: 0, work: 0, warm: 0, qualified: 0, handoff: 0, lose_unknown: 0 });
  const mgrP = {};
  const preTot = { created: 0, work: 0, warm: 0, qualified: 0, handoff: 0, lose_unknown: 0 };

  for (const r of preRows) {
    let idx = 0, loseUnknown = false;
    if (r.sem === 'F') {
      loseUnknown = true; // стадия LOSE ничего не говорит о достигнутом в квалификации
    } else {
      idx = PRE_ORDER[r.stage] !== undefined ? PRE_ORDER[r.stage] : 0;
      if (idx < 1 && r.sem === 'S') idx = 4; // страховка: WON-подобные финальные стадии
    }
    const p = mgrP[r.mgr] || (mgrP[r.mgr] = zeroP());
    p.created++;
    if (idx >= 1) p.work++;
    if (idx >= 2) p.warm++;
    if (idx >= 3) p.qualified++;
    if (idx >= 4) p.handoff++;
    if (loseUnknown) p.lose_unknown++;
    preTot.created++;
    if (idx >= 1) preTot.work++;
    if (idx >= 2) preTot.warm++;
    if (idx >= 3) preTot.qualified++;
    if (idx >= 4) preTot.handoff++;
    if (loseUnknown) preTot.lose_unknown++;
  }
  const qualByManager = Object.entries(mgrP)
    .map(([id, c]) => ({ id, name: name(id), group: getMgrGroup(id), ...c }))
    .sort((a, b) => b.created - a.created || a.name.localeCompare(b.name));

  // ── Список менеджеров для селекта (полный, без mgr-фильтра) ───────────────
  const managers = [...allMgrIds].map(id => ({ id, name: name(id) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  artifacts.lose_unknown.cnt = stageTot.lose_unknown;

  return {
    period: { from: from ? iso(from) : null, to: to ? iso(to) : null },
    mgr: mgrId,
    managers,
    main: { stages: stageTot, by_manager: byManager },
    qual: { stages: preTot, by_manager: qualByManager },
    artifacts,
  };
}
