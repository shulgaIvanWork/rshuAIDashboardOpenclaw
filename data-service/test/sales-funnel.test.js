/**
 * Тесты когортной воронки продаж sales-funnel.js (вкладка «Воронка продаж»).
 *
 * ЗАПУСК: npm test (из data-service/) или node --test data-service/test/
 *
 * Проверяемые инварианты:
 *   - накопительность: created >= mql >= sql >= invoice >= paid (max-этап);
 *   - LOSE без счёта/оплаты НЕ приписывается к MQL (пик неизвестен → lose_unknown);
 *   - «технические» WON (< MIN_OPP) исключены из когорты (tech_won);
 *   - возвраты (LOSE + оплата) достигают PAID;
 *   - ручной «перескок» (сразу в SQL / автооплата без счёта) не выкидывает сделку
 *     из предыдущих ступеней;
 *   - PreSale (кат.8) не попадает в основную воронку и считается в «Квалификации».
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSalesFunnel } from '../lib/sales-funnel.js';

const F = { from: new Date(2026, 0, 1), to: new Date(2026, 11, 31) };
const d = (id, over) => Object.assign({
  ID: id, TITLE: 'Сделка ' + id, CATEGORY_ID: '0', STAGE_ID: 'NEW',
  STAGE_SEMANTIC_ID: 'P', OPPORTUNITY: '100000', DATE_CREATE: '2026-03-10',
  ASSIGNED_BY_ID: '1', UF_DATE_PAY_1C: null, UF_CRM_1753272713011: null,
}, over);
const users = { '1': 'Иванов', '2': 'Петров' };

function run(arr) { return computeSalesFunnel(arr, { ...F, users }); }

// ── Накопительность и max-этап ────────────────────────────────────────────────

test('созданная сделка на NEW → только created', () => {
  const out = run([d(1)]);
  assert.equal(out.main.stages.created, 1);
  assert.equal(out.main.stages.mql, 0);
  assert.equal(out.main.stages.lose_unknown, 0);
});

test('MQL-стадия (UC_4RJOR4) → mql, но не sql', () => {
  const out = run([d(2, { STAGE_ID: 'UC_4RJOR4' })]);
  assert.deepEqual({ mql: out.main.stages.mql, sql: out.main.stages.sql }, { mql: 1, sql: 0 });
});

test('«перескок»: сразу DETAILS (SQL) → накопительно mql и sql', () => {
  const out = run([d(3, { STAGE_ID: 'DETAILS' })]);
  assert.equal(out.main.stages.created, 1);
  assert.equal(out.main.stages.mql, 1);
  assert.equal(out.main.stages.sql, 1);
  assert.equal(out.main.stages.invoice, 0);
});

test('PROPOSAL со счётом → invoice; оплата → paid (все ступени накопительно)', () => {
  const out = run([
    d(4, { STAGE_ID: 'PROPOSAL', UF_CRM_1753272713011: '2026-04-01' }),
    d(5, { STAGE_ID: 'WON', UF_DATE_PAY_1C: '2026-04-10' }),
  ]);
  const s = out.main.stages;
  assert.deepEqual({ created: s.created, mql: s.mql, sql: s.sql, invoice: s.invoice, paid: s.paid },
    { created: 2, mql: 2, sql: 2, invoice: 2, paid: 1 });
});

test('автооплата без счёта (стадия NEW + оплата 1С) → paid и каскад по всем ступеням', () => {
  const out = run([d(6, { UF_DATE_PAY_1C: '2026-05-01' })]);
  const s = out.main.stages;
  assert.deepEqual({ created: s.created, mql: s.mql, sql: s.sql, invoice: s.invoice, paid: s.paid },
    { created: 1, mql: 1, sql: 1, invoice: 1, paid: 1 });
  assert.equal(out.artifacts.paid_no_inv.cnt, 1); // оплата без даты счёта — артефакт
});

test('инвариант накопительности на смеси сделок', () => {
  const out = run([
    d(11, { STAGE_ID: 'NEW' }),
    d(12, { STAGE_ID: 'UC_4RJOR4' }),
    d(13, { STAGE_ID: 'DETAILS' }),
    d(14, { STAGE_ID: 'PROPOSAL', UF_CRM_1753272713011: '2026-04-01' }),
    d(15, { STAGE_ID: 'WON', UF_DATE_PAY_1C: '2026-04-10' }),
  ]);
  const s = out.main.stages;
  assert.ok(s.created >= s.mql && s.mql >= s.sql && s.sql >= s.invoice && s.invoice >= s.paid);
  assert.deepEqual({ created: s.created, mql: s.mql, sql: s.sql, invoice: s.invoice, paid: s.paid },
    { created: 5, mql: 4, sql: 3, invoice: 2, paid: 1 });
});

// ── LOSE: пик неизвестен ──────────────────────────────────────────────────────

test('LOSE без счёта/оплаты → created + lose_unknown, НЕ mql', () => {
  const out = run([d(20, { STAGE_ID: 'LOSE', STAGE_SEMANTIC_ID: 'F' })]);
  const s = out.main.stages;
  assert.equal(s.created, 1);
  assert.equal(s.mql, 0);
  assert.equal(s.lose_unknown, 1);
});

test('возврат (LOSE + оплата 1С) → достиг PAID, артефакт returns', () => {
  const out = run([d(21, { STAGE_ID: 'LOSE', STAGE_SEMANTIC_ID: 'F', UF_DATE_PAY_1C: '2026-06-01' })]);
  const s = out.main.stages;
  assert.equal(s.paid, 1);
  assert.equal(s.lose_unknown, 0);
  assert.equal(out.artifacts.returns.cnt, 1);
});

test('отказ после счёта (LOSE + дата счёта) → invoice, не lose_unknown', () => {
  const out = run([d(22, { STAGE_ID: 'LOSE', STAGE_SEMANTIC_ID: 'F', UF_CRM_1753272713011: '2026-06-01' })]);
  const s = out.main.stages;
  assert.equal(s.invoice, 1);
  assert.equal(s.lose_unknown, 0);
});

// ── Технические WON ───────────────────────────────────────────────────────────

test('технический WON (< MIN_OPP) исключён из когорты → tech_won', () => {
  const out = run([d(30, { STAGE_ID: 'WON', STAGE_SEMANTIC_ID: 'S', OPPORTUNITY: '0' })]);
  assert.equal(out.main.stages.created, 0);
  assert.equal(out.main.stages.tech_won, 1);
  assert.equal(out.artifacts.tech_won.cnt, 1);
});

test('WON с суммой, но без даты 1С → НЕ «Счёт» и НЕ «Оплачено», артефакт won_no_pay', () => {
  const out = run([d(31, { STAGE_ID: 'WON', STAGE_SEMANTIC_ID: 'S', OPPORTUNITY: '50000' })]);
  const s = out.main.stages;
  assert.equal(s.invoice, 0); // WON сам по себе — не счёт
  assert.equal(s.paid, 0);    // оплата определяется только по 1С
  assert.equal(s.mql, 1);     // WON ∈ MQL-стадии (первичный контакт пройден)
  assert.equal(out.artifacts.won_no_pay.cnt, 1);
});

test('накопительность: PROPOSAL (без даты счёта) → И в SQL (по формуле), И в «Счёте»', () => {
  const out = run([d(32, { STAGE_ID: 'PROPOSAL', STAGE_SEMANTIC_ID: 'P' })]);
  const s = out.main.stages;
  assert.equal(s.sql, 1);     // SQL = DETAILS + PROPOSAL + 6 + 2 — не худеет
  assert.equal(s.invoice, 1); // «Счёт» = следующая ступень: PROPOSAL/6/2
  assert.equal(s.mql, 1);
  assert.equal(s.paid, 0);
});

test('стадии 6 «Частично оплачен» и 2 «Постоплата» без 1С → в SQL и в «Счёте»', () => {
  const out = run([
    d(33, { STAGE_ID: '6', STAGE_SEMANTIC_ID: 'P' }),
    d(34, { STAGE_ID: '2', STAGE_SEMANTIC_ID: 'P' }),
  ]);
  const s = out.main.stages;
  assert.equal(s.sql, 2);     // 6 и 2 входят в SQL по формуле
  assert.equal(s.invoice, 2); // и в «Счёт»
  assert.equal(s.paid, 0);
  assert.equal(out.artifacts.won_no_pay.cnt, 0);
});

// ── КОМ (кат.19) ──────────────────────────────────────────────────────────────

test('КОМ: открытая сделка (даже первая стадия «Квалифицирован КОМ») → mql', () => {
  const out = run([d(40, { CATEGORY_ID: '19', STAGE_ID: 'C19:NEW', STAGE_SEMANTIC_ID: 'P' })]);
  const s = out.main.stages;
  assert.equal(s.mql, 1);
  assert.equal(s.sql, 0);
});

test('КОМ: EXECUTING («КП направлено») → sql', () => {
  const out = run([d(41, { CATEGORY_ID: '19', STAGE_ID: 'C19:EXECUTING', STAGE_SEMANTIC_ID: 'P' })]);
  assert.equal(out.main.stages.sql, 1);
});

test('КОМ: WON («Отправлен в SQL») по общей логике — не mql/sql (только создано)', () => {
  const out = run([d(42, { CATEGORY_ID: '19', STAGE_ID: 'C19:WON', STAGE_SEMANTIC_ID: 'S', OPPORTUNITY: '300000' })]);
  const s = out.main.stages;
  assert.equal(s.mql, 0);
  assert.equal(s.sql, 0);
  assert.equal(s.paid, 0);
  assert.equal(s.created, 1);
});

// ── PreSale → «Квалификация» ──────────────────────────────────────────────────

test('PreSale не попадает в основную воронку', () => {
  const out = run([d(50, { CATEGORY_ID: '8', STAGE_ID: 'C8:PREPAYMENT_INVOICE' })]);
  assert.equal(out.main.stages.created, 0);
  assert.equal(out.qual.stages.created, 1);
});

test('PreSale: стадии до «Взят в работу» → только created; PREPAYMENT_INVOICE → квалификация', () => {
  const out = run([
    d(51, { CATEGORY_ID: '8', STAGE_ID: 'C8:NEW' }),
    d(52, { CATEGORY_ID: '8', STAGE_ID: 'C8:PREPAYMENT_INVOICE' }),
  ]);
  const q = out.qual.stages;
  assert.deepEqual({ created: q.created, work: q.work, warm: q.warm, qualified: q.qualified, handoff: q.handoff },
    { created: 2, work: 1, warm: 1, qualified: 1, handoff: 0 });
});

test('PreSale: LOSE → lose_unknown; WON (Передано в ОП) → handoff', () => {
  const out = run([
    d(53, { CATEGORY_ID: '8', STAGE_ID: 'C8:LOSE', STAGE_SEMANTIC_ID: 'F' }),
    d(54, { CATEGORY_ID: '8', STAGE_ID: 'C8:WON', STAGE_SEMANTIC_ID: 'S' }),
  ]);
  const q = out.qual.stages;
  assert.equal(q.created, 2);
  assert.equal(q.handoff, 1);
  assert.equal(q.lose_unknown, 1);
});

// ── Дедуп, период, менеджер ───────────────────────────────────────────────────

test('дедупликация по ID', () => {
  const out = run([d(60), d(60, { STAGE_ID: 'WON' })]);
  assert.equal(out.main.stages.created, 1);
});

test('фильтр периода по DATE_CREATE', () => {
  const out = computeSalesFunnel(
    [d(70, { DATE_CREATE: '2025-12-31' }), d(71, { DATE_CREATE: '2026-01-01' }), d(72, { DATE_CREATE: '2026-06-15' }), d(73, { DATE_CREATE: '2026-07-01' })],
    { from: new Date(2026, 0, 1), to: new Date(2026, 5, 30), users });
  assert.equal(out.main.stages.created, 2); // 71 и 72 — внутри; 70 до, 73 после
});

test('фильтр менеджера', () => {
  const out = run([d(80, { ASSIGNED_BY_ID: '1' }), d(81, { ASSIGNED_BY_ID: '2', STAGE_ID: 'DETAILS' })]);
  const single = computeSalesFunnel(
    [d(80, { ASSIGNED_BY_ID: '1' }), d(81, { ASSIGNED_BY_ID: '2', STAGE_ID: 'DETAILS' })],
    { ...F, users, mgrId: '2' });
  assert.equal(out.main.by_manager.length, 2);
  assert.equal(out.main.by_manager.find(m => m.id === '2').sql, 1);
  assert.equal(single.main.stages.created, 1);
  assert.equal(single.main.by_manager.length, 1);
});

// ── Группы менеджеров (mgr-groups) и контроль суммы ──────────────────────────

test('группы менеджеров: main/bond/afanasyev/tech/autopay/ozk/other', () => {
  const cases = [
    ['513', 'main'], ['1', 'bond'], ['21286', 'afanasyev'],
    ['586', 'tech'], ['516', 'autopay'], ['27165', 'ozk'], ['515', 'other'],
  ];
  const deals = cases.map(([id, g], i) => d(100 + i, { ASSIGNED_BY_ID: id }));
  const out = run(deals);
  const rows = out.main.by_manager;
  assert.equal(rows.length, 7);
  for (const [id, g] of cases) {
    assert.equal(rows.find(r => r.id === id).group, g);
  }
});

test('контроль: сумма by_manager по этапам == итог воронки', () => {
  const deals = [
    d(110, { ASSIGNED_BY_ID: '513', STAGE_ID: 'UC_4RJOR4' }),
    d(111, { ASSIGNED_BY_ID: '1', STAGE_ID: 'DETAILS' }),
    d(112, { ASSIGNED_BY_ID: '21286', STAGE_ID: 'PROPOSAL', UF_CRM_1753272713011: '2026-04-01' }),
    d(113, { ASSIGNED_BY_ID: '586', STAGE_ID: 'WON', UF_DATE_PAY_1C: '2026-04-10' }),
    d(114, { ASSIGNED_BY_ID: '516', STAGE_ID: 'NEW' }),
    d(115, { ASSIGNED_BY_ID: '27165', STAGE_ID: 'LOSE', STAGE_SEMANTIC_ID: 'F' }),
  ];
  const out = run(deals);
  const s = out.main.stages;
  const sum = out.main.by_manager.reduce((acc, r) => {
    acc.created += r.created; acc.mql += r.mql; acc.sql += r.sql;
    acc.invoice += r.invoice; acc.paid += r.paid; acc.lose_unknown += r.lose_unknown;
    return acc;
  }, { created: 0, mql: 0, sql: 0, invoice: 0, paid: 0, lose_unknown: 0 });
  assert.deepEqual(sum, {
    created: s.created, mql: s.mql, sql: s.sql,
    invoice: s.invoice, paid: s.paid, lose_unknown: s.lose_unknown,
  });
  // контроль-пример: ИТОГО = main + Автооплаты + ОЗК + Прочее(other+afanasyev+bond) + Артефакт(tech)
  const grp = g => out.main.by_manager.filter(r => r.group === g).reduce((a, r) => a + r.created, 0);
  const total = ['main', 'autopay', 'ozk', 'other', 'afanasyev', 'bond', 'tech']
    .reduce((a, g) => a + grp(g), 0);
  assert.equal(total, s.created);
});
