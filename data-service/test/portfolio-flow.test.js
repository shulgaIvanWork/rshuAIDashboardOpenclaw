/**
 * Тесты движения портфеля portfolio-flow.js (Sankey, вкладка «Воронка продаж»).
 *
 * ЗАПУСК: npm test (из data-service/)
 *
 * Проверяемые инварианты:
 *   - баланс: start + created + reopened == available == paid + refused + end;
 *   - одна сделка — ровно в одном исходе (приоритет Оплачено > Отказано > Остаток);
 *   - тех. WON и WON-без-1С вне портфеля (meta);
 *   - LOSE без даты отказа закрывается по CLOSEDATE (никаких «мёртвых душ»
 *     в остатках для прошлых периодов);
 *   - возврат (оплата + отказ в периоде) → только «Оплачено»;
 *   - endBreakdown: только для to == asOf (current) или при переданном снапшоте.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePortfolioFlow, classifyEndStage } from '../lib/portfolio-flow.js';
import { collectSnapshot } from '../lib/snapshot.js';

const Y2026 = { from: new Date(2026, 0, 1), to: new Date(2026, 11, 31), asOf: new Date(2026, 11, 31) };
const d = (id, over) => Object.assign({
  ID: id, TITLE: 'Сделка ' + id, CATEGORY_ID: '0', STAGE_ID: 'NEW',
  STAGE_SEMANTIC_ID: 'P', OPPORTUNITY: '100000', DATE_CREATE: '2026-03-10',
  CLOSEDATE: null, ASSIGNED_BY_ID: '1',
  UF_DATE_PAY_1C: null, UF_CRM_1753272713011: null, UF_CRM_1753341391806: null,
}, over);
const run = (arr, over) => computePortfolioFlow(arr, { ...Y2026, ...(over || {}) });
const bal = out => {
  const n = out.nodes;
  assert.equal(n.start.cnt + n.created.cnt + n.reopened.cnt, n.available.cnt, 'втекает == available');
  assert.equal(n.available.cnt, n.paid.cnt + n.refused.cnt + n.end.cnt, 'available == исходящие');
};

// ── Баланс и базовая логика ───────────────────────────────────────────────────

test('пусто → все узлы 0, баланс', () => {
  const out = run([]);
  bal(out);
  assert.equal(out.nodes.available.cnt, 0);
  assert.equal(out.endBreakdown, null);
});

test('создана и оплачена в периоде → created → paid', () => {
  const out = run([d(1, { UF_DATE_PAY_1C: '2026-04-01' })]);
  assert.equal(out.nodes.created.cnt, 1);
  assert.equal(out.nodes.paid.cnt, 1);
  assert.equal(out.nodes.end.cnt, 0);
  bal(out);
});

test('оплата до периода (создана до периода) → вне портфеля', () => {
  const out = run([d(2, { DATE_CREATE: '2025-06-01', UF_DATE_PAY_1C: '2025-07-01' })]);
  assert.equal(out.nodes.available.cnt, 0);
  bal(out);
});

test('создана до периода, не закрыта → остаток на начало → остаток на конец', () => {
  const out = run([d(3, { DATE_CREATE: '2025-06-01' })]);
  assert.equal(out.nodes.start.cnt, 1);
  assert.equal(out.nodes.end.cnt, 1);
  bal(out);
});

test('создана до периода, отказана в периоде (дата отказа) → start → refused', () => {
  const out = run([d(4, { DATE_CREATE: '2025-06-01', STAGE_ID: 'LOSE', STAGE_SEMANTIC_ID: 'F', CLOSEDATE: '2026-02-01', UF_CRM_1753341391806: '2026-02-01' })]);
  assert.equal(out.nodes.start.cnt, 1);
  assert.equal(out.nodes.refused.cnt, 1);
  assert.equal(out.nodes.end.cnt, 0);
  bal(out);
});

// ── CLOSEDATE-fallback (LOSE без даты отказа) ────────────────────────────────

test('LOSE без даты отказа, CLOSEDATE до периода → НЕ в остатке (нет мёртвых душ)', () => {
  const out = run([d(5, { DATE_CREATE: '2025-06-01', STAGE_ID: 'LOSE', STAGE_SEMANTIC_ID: 'F', CLOSEDATE: '2025-07-01' })]);
  assert.equal(out.nodes.available.cnt, 0);
  bal(out);
});

test('LOSE без даты отказа, CLOSEDATE в периоде → refused (по CLOSEDATE)', () => {
  const out = run([d(6, { DATE_CREATE: '2025-06-01', STAGE_ID: 'LOSE', STAGE_SEMANTIC_ID: 'F', CLOSEDATE: '2026-02-15' })]);
  assert.equal(out.nodes.start.cnt, 1);
  assert.equal(out.nodes.refused.cnt, 1);
  bal(out);
});

test('LOSE без даты отказа, CLOSEDATE после конца периода (но в прошлом) → в остатке на конец', () => {
  // период [01.01..30.06.2026], выгрузка asOf = 31.12.2026; CLOSEDATE 01.09.2026
  // — на 30.06 сделка реально была в работе (закрылась позже)
  const out = computePortfolioFlow(
    [d(7, { DATE_CREATE: '2025-06-01', STAGE_ID: 'LOSE', STAGE_SEMANTIC_ID: 'F', CLOSEDATE: '2026-09-01' })],
    { from: new Date(2026, 0, 1), to: new Date(2026, 5, 30), asOf: new Date(2026, 11, 31) });
  assert.equal(out.nodes.start.cnt, 1);
  assert.equal(out.nodes.end.cnt, 1);
  bal(out);
});

test('LOSE с битой датой отказа (в будущем после выгрузки) → аномалия, не «в работе»', () => {
  const out = run([d(15, { STAGE_ID: 'LOSE', STAGE_SEMANTIC_ID: 'F', CLOSEDATE: '2045-05-05' })]);
  assert.equal(out.nodes.available.cnt, 0);
  assert.equal(out.meta.ignored.cnt, 1);
  bal(out);
});

// ── Приоритеты и артефакты ───────────────────────────────────────────────────

test('возврат (оплата + отказ в периоде) → только paid, refused не растёт', () => {
  const out = run([d(8, { STAGE_ID: 'LOSE', STAGE_SEMANTIC_ID: 'F', CLOSEDATE: '2026-04-01', UF_DATE_PAY_1C: '2026-03-01', UF_CRM_1753341391806: '2026-04-01' })]);
  assert.equal(out.nodes.paid.cnt, 1);
  assert.equal(out.nodes.refused.cnt, 0);
  bal(out);
});

test('тех. WON (< 11) и WON без 1С — вне портфеля (meta)', () => {
  const out = run([
    d(9, { STAGE_ID: 'WON', STAGE_SEMANTIC_ID: 'S', OPPORTUNITY: '0' }),
    d(10, { STAGE_ID: 'WON', STAGE_SEMANTIC_ID: 'S', OPPORTUNITY: '50000' }), // WON без UF_DATE_PAY_1C
  ]);
  assert.equal(out.nodes.available.cnt, 0);
  assert.equal(out.meta.tech_won, 1);
  assert.equal(out.meta.won_no_pay, 1);
  bal(out);
});

test('WON с оплатой 1С в периоде → paid', () => {
  const out = run([d(11, { STAGE_ID: 'WON', STAGE_SEMANTIC_ID: 'S', UF_DATE_PAY_1C: '2026-05-01' })]);
  assert.equal(out.nodes.paid.cnt, 1);
  bal(out);
});

test('оплата суммой < 11 не считается оплатой (остаётся в работе)', () => {
  const out = run([d(12, { OPPORTUNITY: '10', UF_DATE_PAY_1C: '2026-05-01' })]);
  assert.equal(out.nodes.paid.cnt, 0);
  assert.equal(out.nodes.end.cnt, 1);
  bal(out);
});

test('PreSale (кат.8) и КОМ (кат.19) не входят в портфель Sale', () => {
  const out = run([d(13, { CATEGORY_ID: '8' }), d(14, { CATEGORY_ID: '19' })]);
  assert.equal(out.nodes.available.cnt, 0);
});

test('фильтр менеджера', () => {
  const deals = [d(20, { ASSIGNED_BY_ID: '1' }), d(21, { ASSIGNED_BY_ID: '2' })];
  const out = run(deals, { mgrId: '2' });
  assert.equal(out.nodes.created.cnt, 1);
  bal(out);
});

test('суммы узлов = сумма OPPORTUNITY', () => {
  const out = run([d(30, { OPPORTUNITY: '50000', UF_DATE_PAY_1C: '2026-05-01' })]);
  assert.equal(out.nodes.created.sum, 50000);
  assert.equal(out.nodes.paid.sum, 50000);
});

// ── Технические зачистки (массовое закрытие хвоста) ──────────────────────────

function manyLose(n, startId, dayISO, createdISO) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    arr.push(d(startId + i, { STAGE_ID: 'LOSE', STAGE_SEMANTIC_ID: 'F', CLOSEDATE: dayISO, DATE_CREATE: createdISO }));
  }
  return arr;
}

test('тех. зачистка: >30 LOSE в день и возраст >180д → вне портфеля (meta.tech_purge)', () => {
  // 31 «висяк»: созданы 2025-01-01, закрыты одним днём 2026-08-24 (возраст > 180)
  const deals = manyLose(31, 200, '2026-08-24', '2025-01-01');
  const out = run(deals);
  assert.equal(out.nodes.available.cnt, 0);
  assert.equal(out.meta.tech_purge.cnt, 31);
  bal(out);
});

test('порог: 30 LOSE в день — ещё НЕ зачистка; 31-й день считается по всей базе', () => {
  const deals30 = manyLose(30, 300, '2026-08-24', '2025-01-01');
  const out30 = run(deals30);
  assert.equal(out30.meta.tech_purge.cnt, 0);   // ровно 30 → не пик
  assert.equal(out30.nodes.refused.cnt, 30);
  // +1 сделка в тот же день (всего 31) → пик, зачищаются все с возрастом > 180
  const out31 = run(deals30.concat(manyLose(1, 400, '2026-08-24', '2025-01-01')));
  assert.equal(out31.meta.tech_purge.cnt, 31);
  assert.equal(out31.nodes.refused.cnt, 0);
  bal(out31);
});

test('свежий отказ в пиковый день (возраст < 180д) — НЕ зачистка', () => {
  const old = manyLose(31, 500, '2026-08-24', '2025-01-01'); // создают пик
  const fresh = d(600, { STAGE_ID: 'LOSE', STAGE_SEMANTIC_ID: 'F', CLOSEDATE: '2026-08-24', DATE_CREATE: '2026-08-01' });
  const out = run(old.concat(fresh));
  assert.equal(out.meta.tech_purge.cnt, 31);
  assert.equal(out.nodes.refused.cnt, 1);      // свежий остаётся в портфеле
  bal(out);
});

// ── endBreakdown ──────────────────────────────────────────────────────────────

test('endBreakdown для to == asOf (current): остаток разбит по этапам, «Счёт» — тремя стадиями', () => {
  const out = run([
    d(40, { STAGE_ID: 'NEW' }),                                  // до MQL
    d(41, { STAGE_ID: 'UC_4RJOR4' }),                            // MQL
    d(42, { STAGE_ID: 'DETAILS' }),                              // SQL
    d(43, { STAGE_ID: 'PROPOSAL' }),                             // Счёт отправлен
    d(44, { STAGE_ID: '2' }),                                    // Постоплата
    d(45, { STAGE_ID: '6' }),                                    // Частичная оплата
    d(46, { STAGE_ID: 'UC_STZB49' }),                            // до MQL (исходная)
  ]);
  assert.equal(out.breakdownSource, 'current');
  const b = Object.fromEntries(out.endBreakdown.map(s => [s.key, s.cnt]));
  assert.deepEqual(b, { pre_mql: 2, mql: 1, sql: 1, inv_proposal: 1, inv_partial: 1, inv_postpay: 1 });
  assert.equal(out.endBreakdown.reduce((a, s) => a + s.cnt, 0), out.nodes.end.cnt);
});

test('endBreakdown для прошлого to без снапшота → приближение по текущим стадиям (approx)', () => {
  // сделка открыта (NEW) → в остатке на конец 2025 и сейчас; стадии — текущие (приближение)
  const out = run([d(50, { DATE_CREATE: '2025-06-01' })], { to: new Date(2025, 11, 31), asOf: new Date(2026, 11, 31) });
  assert.equal(out.breakdownSource, 'approx');
  assert.equal(out.nodes.end.cnt, 1);
  const b = Object.fromEntries(out.endBreakdown.map(s => [s.key, s.cnt]));
  assert.deepEqual(b, { pre_mql: 1 }); // по текущей стадии NEW
});

test('approx: сделки остатка, закрытые LOSE/WON после конца периода → отдельные сегменты, не mql', () => {
  // остаток на 31.08.2025: две сделки; к «сегодня» (asOf 2026) одна стала LOSE, одна оплачена (WON)
  const loseLater = d(61, { DATE_CREATE: '2025-06-01', STAGE_ID: 'LOSE', STAGE_SEMANTIC_ID: 'F', CLOSEDATE: '2025-09-15' });
  const wonLater = d(62, { DATE_CREATE: '2025-06-01', STAGE_ID: 'WON', STAGE_SEMANTIC_ID: 'S', UF_DATE_PAY_1C: '2025-10-01' });
  const out = computePortfolioFlow(
    [loseLater, wonLater],
    { from: new Date(2025, 7, 1), to: new Date(2025, 7, 31), asOf: new Date(2026, 11, 31) });
  assert.equal(out.breakdownSource, 'approx');
  assert.equal(out.nodes.end.cnt, 2);
  const b = Object.fromEntries(out.endBreakdown.map(s => [s.key, s.cnt]));
  assert.deepEqual(b, { refused_after: 1, paid_after: 1 });
  assert.equal(out.endBreakdown.reduce((a, s) => a + s.cnt, 0), out.nodes.end.cnt);
});

test('endBreakdown для прошлого to со снапшотом → классификация из снапшота', () => {
  const deal = d(60, { DATE_CREATE: '2025-06-01', STAGE_ID: 'DETAILS', STAGE_SEMANTIC_ID: 'P' });
  // снапшот на 31.08.2025: сделка в работе на стадии NEW (тогда была NEW)
  const snap = collectSnapshot([Object.assign({}, deal, { STAGE_ID: 'NEW', STAGE_SEMANTIC_ID: 'P' })], '2025-08-31');
  const out = computePortfolioFlow([deal], { from: new Date(2025, 7, 1), to: new Date(2025, 7, 31), asOf: new Date(2026, 11, 31), snapshot: snap });
  assert.equal(out.breakdownSource, 'snapshot:2025-08-31');
  assert.equal(out.nodes.end.cnt, 1);
  const b = Object.fromEntries(out.endBreakdown.map(s => [s.key, s.cnt]));
  assert.deepEqual(b, { pre_mql: 1 }); // по снапшоту сделка была на NEW
});

// ── classifyEndStage ──────────────────────────────────────────────────────────

test('classifyEndStage: кат.0; «Следующий год» — отдельно, «Счёт» разбит на 3 стадии', () => {
  assert.equal(classifyEndStage('0', 'NEW', 'P'), 'pre_mql');
  assert.equal(classifyEndStage('0', 'UC_STZB49', 'P'), 'pre_mql');   // «Взят в работу»
  assert.equal(classifyEndStage('0', 'UC_VKPN0N', 'P'), 'pre_mql');   // «Приоритет»
  assert.equal(classifyEndStage('0', 'UC_4RJOR4', 'P'), 'mql');
  assert.equal(classifyEndStage('0', 'DETAILS', 'P'), 'sql');
  assert.equal(classifyEndStage('0', 'PROPOSAL', 'P'), 'inv_proposal'); // Счёт отправлен
  assert.equal(classifyEndStage('0', '6', 'P'), 'inv_partial');         // Частичная оплата
  assert.equal(classifyEndStage('0', '2', 'P'), 'inv_postpay');         // Постоплата
  assert.equal(classifyEndStage('0', 'UC_W6SCHG', 'P'), 'deferred');    // «Следующий год» — не MQL
  assert.equal(classifyEndStage('19', 'EXECUTING', 'P'), 'pre_mql');    // КОМ вне Sale
});
