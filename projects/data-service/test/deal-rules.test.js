/**
 * Тесты бизнес-правил deal-rules.js.
 *
 * ЗАПУСК: npm test (из data-service/) или node --test data-service/test/
 *
 * Примеры сделок — реальные случаи из deals.json, на которых ловились баги:
 *   322708 — нулевая WON без оплаты (техническая, не считается оплаченной)
 *   303055 — КОМ по всем признакам сразу (формат + флаг + направление числом)
 *   318197 — постоплата (stage 2), большая сумма, 1С-даты ещё нет
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isKomDeal, isPaidDeal, isMqlDeal, detectFormat, detectB2b,
  MIN_OPP, VALID_CATS, UF,
} from '../lib/deal-rules.js';

// ── isKomDeal ─────────────────────────────────────────────────────────────────

test('isKomDeal: флаг КОМ = "1"', () => {
  assert.equal(isKomDeal({ [UF.KOM_FLAG]: '1' }), true);
  assert.equal(isKomDeal({ [UF.KOM_FLAG]: 'Y' }), true);
  assert.equal(isKomDeal({ [UF.KOM_FLAG]: true }), true);
});

test('isKomDeal: формат 19042498', () => {
  assert.equal(isKomDeal({ [UF.FORMAT]: '19042498' }), true);
  assert.equal(isKomDeal({ [UF.FORMAT]: '19042467' }), false);
});

test('isKomDeal: направление 1906 ЧИСЛОМ в массиве (баг management/participants)', () => {
  // В deals.json направление приходит числами: [1906].
  // Старая копия правила сравнивала со строкой и молча промахивалась.
  assert.equal(isKomDeal({ [UF.DIRECTION]: [1906] }), true);
  assert.equal(isKomDeal({ [UF.DIRECTION]: ['1906'] }), true);
  assert.equal(isKomDeal({ [UF.DIRECTION]: 1906 }), true);
  assert.equal(isKomDeal({ [UF.DIRECTION]: [1917] }), false);
});

test('isKomDeal: воронка 19 и тип обучения 34765', () => {
  assert.equal(isKomDeal({ CATEGORY_ID: '19' }), true);
  assert.equal(isKomDeal({ [UF.EDU_TYPE]: '34765' }), true);
  assert.equal(isKomDeal({ CATEGORY_ID: '0' }), false);
});

test('isKomDeal: реальная сделка 303055 (КОМ по трём признакам)', () => {
  const d = {
    ID: '303055', CATEGORY_ID: '0',
    [UF.FORMAT]: '19042498',
    [UF.DIRECTION]: [1906],
    [UF.KOM_FLAG]: '1',
    [UF.EDU_TYPE]: '34765',
  };
  assert.equal(isKomDeal(d), true);
});

// ── isPaidDeal ────────────────────────────────────────────────────────────────

test('isPaidDeal: нулевая WON без 1С-даты — НЕ оплата (сделка 322708)', () => {
  const d = { ID: '322708', STAGE_ID: 'WON', STAGE_SEMANTIC_ID: 'S', OPPORTUNITY: '0.00', [UF.PAY_DATE_1C]: '' };
  assert.equal(isPaidDeal(d), false);
});

test('isPaidDeal: постоплата без 1С-даты — ещё НЕ оплата (сделка 318197)', () => {
  const d = { ID: '318197', STAGE_ID: '2', OPPORTUNITY: '578080', [UF.PAY_DATE_1C]: '' };
  assert.equal(isPaidDeal(d), false);
});

test('isPaidDeal: есть 1С-дата и сумма >= MIN_OPP — оплата', () => {
  const d = { OPPORTUNITY: '99000', [UF.PAY_DATE_1C]: '2026-02-25T03:00:00+03:00' };
  assert.equal(isPaidDeal(d), true);
});

test('isPaidDeal: техническая сумма ниже MIN_OPP — не оплата', () => {
  const d = { OPPORTUNITY: String(MIN_OPP - 1), [UF.PAY_DATE_1C]: '2026-01-01' };
  assert.equal(isPaidDeal(d), false);
  // Ровно MIN_OPP — считается
  assert.equal(isPaidDeal({ OPPORTUNITY: String(MIN_OPP), [UF.PAY_DATE_1C]: '2026-01-01' }), true);
});

// ── isMqlDeal ─────────────────────────────────────────────────────────────────

test('isMqlDeal: Sale-воронка — NEW не MQL, DETAILS уже MQL', () => {
  assert.equal(isMqlDeal({ CATEGORY_ID: '0', STAGE_ID: 'NEW' }), false);
  assert.equal(isMqlDeal({ CATEGORY_ID: '0', STAGE_ID: 'DETAILS' }), true);
  assert.equal(isMqlDeal({ CATEGORY_ID: '0', STAGE_ID: 'WON', OPPORTUNITY: '50000' }), true);
});

test('isMqlDeal: стадии с префиксом воронки (C0:DETAILS) распознаются', () => {
  assert.equal(isMqlDeal({ CATEGORY_ID: '0', STAGE_ID: 'C0:DETAILS' }), true);
});

test('isMqlDeal: нулевая WON — не MQL', () => {
  assert.equal(isMqlDeal({ CATEGORY_ID: '0', STAGE_ID: 'WON', STAGE_SEMANTIC_ID: 'S', OPPORTUNITY: '0' }), false);
});

test('isMqlDeal: КОМ-воронка — в работе MQL, закрытая нет', () => {
  assert.equal(isMqlDeal({ CATEGORY_ID: '19', STAGE_ID: 'C19:EXECUTING', STAGE_SEMANTIC_ID: 'P' }), true);
  assert.equal(isMqlDeal({ CATEGORY_ID: '19', STAGE_ID: 'C19:WON', STAGE_SEMANTIC_ID: 'S', OPPORTUNITY: '100000' }), false);
});

test('isMqlDeal: чужая воронка — не MQL', () => {
  assert.equal(isMqlDeal({ CATEGORY_ID: '5', STAGE_ID: 'DETAILS' }), false);
});

// ── detectFormat ──────────────────────────────────────────────────────────────

test('detectFormat: UF_FORMAT приоритетнее названия', () => {
  assert.equal(detectFormat('Онлайн курс', '19042467'), 'Очный');
  assert.equal(detectFormat('что угодно', '19042468'), 'Онлайн');
  assert.equal(detectFormat('x', '19042498'), 'Корпоративное обучение');
});

test('detectFormat: эвристика по названию, когда UF_FORMAT пуст', () => {
  assert.equal(detectFormat('Рекрутмент  (СДО)', null), 'Видеокурс');
  assert.equal(detectFormat('Курс онлайн для всех', null), 'Онлайн');
  assert.equal(detectFormat('Тренинг 01.02 в г. Москва', null), 'Очный');
  assert.equal(detectFormat('Просто курс', null), 'Онлайн'); // дефолт
});

// ── detectB2b ─────────────────────────────────────────────────────────────────

test('detectB2b: по компании и КОМ-воронке', () => {
  assert.equal(detectB2b({ COMPANY_ID: '19446', CATEGORY_ID: '0' }), 'B2B');
  assert.equal(detectB2b({ COMPANY_ID: '0', CATEGORY_ID: '0' }), 'B2C');
  assert.equal(detectB2b({ COMPANY_ID: null, CATEGORY_ID: '0' }), 'B2C');
  assert.equal(detectB2b({ COMPANY_ID: '0', CATEGORY_ID: '19' }), 'B2B'); // КОМ всегда B2B
});

// ── Константы ─────────────────────────────────────────────────────────────────

test('константы: воронки и минимальная сумма', () => {
  assert.equal(MIN_OPP, 11.0);
  assert.deepEqual([...VALID_CATS].sort(), [0, 19, 8].sort());
});
