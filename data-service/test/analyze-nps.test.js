/**
 * Тесты категории NPS (analyze-nps.js).
 *
 * ЗАПУСК: npm test (из data-service/) или node --test data-service/test/
 *
 * Случай из жизни: в августе 2026 у 46 из 94 сделок на стадии «Заполнил NPS» была оценка,
 * но не был проставлен «Статус участника обучения», и дашборд показывал 48 заполнивших вместо 94.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getNpsCategory, aggregateByMonth } from '../analyze-nps.js';
import { UF, LEARNER_STATUS } from '../lib/deal-rules.js';

const deal = (over) => ({ STAGE_ID: 'C9:UC_9N3TCX', DATE_CREATE: '2026-08-10T10:00:00+03:00', ...over });

test('getNpsCategory: статус участника важнее оценки', () => {
  assert.equal(getNpsCategory(deal({ [UF.LEARNER_STATUS]: LEARNER_STATUS.PROMOTER, [UF.NPS_SCORE]: '8' })), 'promoter');
  assert.equal(getNpsCategory(deal({ [UF.LEARNER_STATUS]: LEARNER_STATUS.NO_CONTACT, [UF.NPS_SCORE]: '10' })), 'no_contact');
});

test('getNpsCategory: без статуса - по оценке 9-10 / 7-8 / 0-6', () => {
  assert.equal(getNpsCategory(deal({ [UF.NPS_SCORE]: '10' })), 'promoter');
  assert.equal(getNpsCategory(deal({ [UF.NPS_SCORE]: '9' })), 'promoter');
  assert.equal(getNpsCategory(deal({ [UF.NPS_SCORE]: '8' })), 'passive');
  assert.equal(getNpsCategory(deal({ [UF.NPS_SCORE]: '7' })), 'passive');
  assert.equal(getNpsCategory(deal({ [UF.NPS_SCORE]: '6' })), 'detractor');
  assert.equal(getNpsCategory(deal({ [UF.NPS_SCORE]: '4' })), 'detractor');
});

test('getNpsCategory: ни статуса, ни оценки - null', () => {
  assert.equal(getNpsCategory(deal({})), null);
  assert.equal(getNpsCategory(deal({ [UF.NPS_SCORE]: '' })), null);
});

test('aggregateByMonth: заполненная анкета без статуса попадает в заполнившие', () => {
  const deals = [
    deal({ [UF.LEARNER_STATUS]: LEARNER_STATUS.PROMOTER, [UF.NPS_SCORE]: '10' }),
    deal({ [UF.NPS_SCORE]: '10' }),
    deal({ [UF.NPS_SCORE]: '7' }),
    deal({}),                                                     // стадия заполнена, данных нет
    deal({ STAGE_ID: 'C9:UC_0Z9C0Q', [UF.NPS_SCORE]: '10' }),     // только запрошен
  ];
  const aug = aggregateByMonth(deals, 2026)[7];
  assert.equal(aug.sent, 5);
  assert.equal(aug.filled, 3);
  assert.equal(aug.promoters, 2);
  assert.equal(aug.neutrals, 1);
  assert.equal(aug.detractors, 0);
});
