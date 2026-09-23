import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enrichForKpi, calcPeriodKpi } from '../lib/period-kpi.js';

const deals = [
  { ID: '304598', CATEGORY_ID: '0', OPPORTUNITY: '556000', DATE_CREATE: '2026-02-01', UF_DATE_PAY_1C: '2026-08-31', STAGE_SEMANTIC_ID: 'S' },
  { ID: '322565', CATEGORY_ID: '19', OPPORTUNITY: '536000', DATE_CREATE: '2026-06-01', UF_DATE_PAY_1C: '2026-08-24', STAGE_SEMANTIC_ID: 'S' },
  { ID: '100', CATEGORY_ID: '0', OPPORTUNITY: '100000', DATE_CREATE: '2026-07-01', UF_DATE_PAY_1C: '2026-08-10', STAGE_SEMANTIC_ID: 'S' },
];

const payments = [
  { dealId: '304598', date: '2026-06-11', amount: 39718 },
  { dealId: '304598', date: '2026-06-30', amount: 39714 },
  { dealId: '304598', date: '2026-08-06', amount: 39714 },
  { dealId: '304598', date: '2026-08-31', amount: 39714 },
  { dealId: '322565', date: '2026-07-16', amount: 190000 },
  { dealId: '322565', date: '2026-08-24', amount: 346000 },
];

test('август: транши заменяют полную сумму сделки, fallback сохраняется', () => {
  const rows = enrichForKpi(deals, payments);
  const august = calcPeriodKpi(rows, new Date('2026-08-01'), new Date('2026-08-31'));
  assert.equal(august.total.postupleniya, 525428); // 79 428 + 346 000 + 100 000
  assert.equal(august.total.won_relevant_cnt, 3);
});

test('июнь: два транша одной сделки — одна оплаченная сделка', () => {
  const rows = enrichForKpi(deals, payments);
  const june = calcPeriodKpi(rows, new Date('2026-06-01'), new Date('2026-06-30'));
  assert.equal(june.total.postupleniya, 79432);
  assert.equal(june.total.won_relevant_cnt, 1);
});
