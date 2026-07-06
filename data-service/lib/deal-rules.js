/**
 * deal-rules.js — ЕДИНЫЙ источник бизнес-правил для сделок Bitrix24.
 *
 * ЗАЧЕМ:
 *   Правила «что такое КОМ-сделка», «что считается оплатой», «какие стадии MQL»
 *   раньше были скопированы в 6 местах (analyze.js + 5 дашбордов) и уже успели
 *   разойтись (kom-dashboard не проверял направление 1906; management/participants
 *   сравнивали направление-число со строкой и молча промахивались).
 *   Теперь правило меняется здесь — и меняется везде.
 *
 * КТО ИМПОРТИРУЕТ:
 *   data-service/analyze.js и server.js всех дашбордов:
 *     import { isKomDeal, MIN_OPP, YEAR, UF, ... } from '@rshu/data-service/lib/deal-rules.js'
 *
 * ПОЛНЫЙ СПРАВОЧНИК ПОЛЕЙ: data-service/docs/CRM_FIELDS_REFERENCE.md
 */

// ── Отчётный год ──────────────────────────────────────────────────────────────
// По умолчанию — текущий календарный год (не сломается в январе).
// Можно зафиксировать через переменную окружения RSHU_YEAR=2026.
export const YEAR = parseInt(process.env.RSHU_YEAR || '', 10) || new Date().getFullYear();

// Минимальная сумма сделки, чтобы считать её «настоящей» оплатой.
// Технические/нулевые сделки (созданные ботом для статистики) отсекаются.
export const MIN_OPP = 11.0;

// ── Словарь кастомных UF-полей сделки (имена → коды Битрикса) ────────────────
// Описания всех полей: docs/CRM_FIELDS_REFERENCE.md
export const UF = {
  PAY_DATE_1C:       'UF_DATE_PAY_1C',          // Дата оплаты из 1С — главный признак реальных денег
  FORMAT:            'UF_FORMAT',                // Формат обучения (см. FORMAT_MAP)
  DIRECTION:         'UF_CRM_1498466811',        // Направление обучения (список, может быть массивом чисел)
  KOM_FLAG:          'UF_CRM_1683882427069',     // «КОМ» Да/Нет
  EDU_TYPE:          'UF_CRM_1765896709800',     // Тип обучения (ПК/ПП/КО, см. EDU_TYPE_MAP)
  INVOICE_SENT_DATE: 'UF_CRM_1753272713011',     // Дата «Счёт отправлен»
  REFUSE_DATE:       'UF_CRM_1753341391806',     // Дата отказа
  LEARN_START:       'UF_CRM_DATE_START_LEARN',  // Дата начала обучения (уровень сделки)
  LEARN_END:         'UF_CRM_DATE_END_LEARN',    // Дата конца обучения (уровень сделки)
  PRODUCT_NAME:      'UF_CRM_1697096074',        // Продукт (чистое название программы)
  DIRECTION_CREATED: 'UF_CRM_1744273716729',     // Направление обучения (текст, при создании)
  AGREED_PAY_DATE:   'UF_CRM_1474975772',        // Согласованная дата оплаты
  DEAL_DOCUMENTS:    'UF_CRM_1519917152',        // Файлы на диске (JSON-массив с id_file_disk и ссылками)
};

// ── Воронки (CATEGORY_ID) ─────────────────────────────────────────────────────
export const CAT_SALE     = 0;   // Sale — основная воронка
export const CAT_PRESALE  = 8;   // Pre Sale
export const CAT_KOM      = 19;  // КОМ (корпоративное обучение)
export const VALID_CATS = new Set([CAT_SALE, CAT_PRESALE, CAT_KOM]);

// ── КОМ-признаки ──────────────────────────────────────────────────────────────
export const KOM_FORMAT_ID    = '19042498'; // UF_FORMAT = КОМ
export const KOM_DIRECTION_ID = '1906';     // направление «Корпоративное обучение»
export const KOM_TRAINING_ID  = '34765';    // тип обучения «Корпоративное обучение»

// ── Источники ─────────────────────────────────────────────────────────────────
export const REG_SRC_ID = '79641902890';    // источник «Регистрация»
export const INTERNAL_SOURCE_IDS = new Set([
  '79641902894','79641902977','79641902926','UC_7G65N9','79641902903','RECOMMENDATION',
]);

// ── Направления MBA ───────────────────────────────────────────────────────────
export const MBA_DIRECTION_IDS = new Set(['1917', '35288']);

// ── Стадии воронки Sale для MQL ───────────────────────────────────────────────
// MQL = лид прошёл первичный контакт (любая стадия из MQL_SALE_STAGES).
// NOT_MQL_SALE = ещё не обработан / некачественный.
export const MQL_SALE_STAGES = new Set(['UC_4RJOR4','DETAILS','PROPOSAL','2','6','WON','LOSE',
  'UC_F2YC3N','UC_VKPN0N','UC_W6SCHG','UC_670ME2']);
export const NOT_MQL_SALE = new Set(['NEW','UC_1YW3V2','UC_STZB49','UC_838R2R']);

// SQL = узкая квалификация: дошёл до обсуждения деталей/счёта.
export const SQL_STAGES = ['DETAILS','PROPOSAL','2','6','WON'];

// ── Справочники значений ──────────────────────────────────────────────────────
export const EDU_TYPE_MAP = {
  '34699':'Повышение квалификации','34700':'Проф. переподготовка','34765':'Корпоративное обучение',
};
export const FORMAT_MAP = {
  '19042467':'Очный','19042468':'Онлайн','19042469':'Видеокурс',
  '19042498':'Корпоративное обучение','19042495':'MMBA','19042497':'Вечерний','19042496':'ГК',
};

// ── Правила (работают с СЫРОЙ сделкой из deals.json) ─────────────────────────

/** Сумма сделки числом. */
export function getOpp(d) { return parseFloat(d.OPPORTUNITY || 0); }

/**
 * КОМ-сделка (корпоративное обучение) — любой из признаков:
 * флаг КОМ, формат КОМ, направление 1906, воронка 19, тип обучения КО.
 * Направление может прийти массивом ЧИСЕЛ — обязательно приводим к строкам.
 */
export function isKomDeal(d) {
  const flag = d[UF.KOM_FLAG];
  if (flag === 'Y' || flag === '1' || flag === true) return true;
  if (String(d[UF.FORMAT] || '') === KOM_FORMAT_ID) return true;
  const dir = d[UF.DIRECTION] || [];
  if ((Array.isArray(dir) ? dir : [dir]).map(String).includes(KOM_DIRECTION_ID)) return true;
  if (parseInt(d.CATEGORY_ID || 0) === CAT_KOM) return true;
  if (String(d[UF.EDU_TYPE] || '') === KOM_TRAINING_ID) return true;
  return false;
}

/**
 * Реально оплаченная сделка: есть дата оплаты из 1С и сумма не техническая.
 * (WON-стадия сама по себе НЕ означает оплату — бывают нулевые технические WON.)
 */
export function isPaidDeal(d) {
  return !!d[UF.PAY_DATE_1C] && getOpp(d) >= MIN_OPP;
}

/**
 * MQL-квалификация по сырой сделке (для воронок Sale и КОМ).
 * Для Sale: стадия прошла первичный контакт; для КОМ: сделка в работе.
 */
export function isMqlDeal(d) {
  const cat = parseInt(d.CATEGORY_ID || 0);
  if (!VALID_CATS.has(cat)) return false;
  const stage = String(d.STAGE_ID || '').replace(/^C\d+:/, '');
  if (d.STAGE_SEMANTIC_ID === 'S' && getOpp(d) < MIN_OPP) return false;
  if (cat === CAT_SALE) return NOT_MQL_SALE.has(stage) ? false : MQL_SALE_STAGES.has(stage);
  if (cat === CAT_KOM)  return !(d.STAGE_SEMANTIC_ID === 'S' || d.STAGE_SEMANTIC_ID === 'F');
  return false;
}

/** Внутренний источник (не считается внешним лидом). */
export function isInternalSource(srcId) {
  return srcId ? INTERNAL_SOURCE_IDS.has(String(srcId)) : false;
}

/**
 * Формат обучения: сначала по UF_FORMAT, потом эвристика по названию.
 */
export function detectFormat(title, ufFormat) {
  if (ufFormat && FORMAT_MAP[String(ufFormat)]) return FORMAT_MAP[String(ufFormat)];
  const t = (title || '').toLowerCase();
  if (t.includes('(сдо)') || t.includes(' сдо') || t.endsWith('сдо')) return 'Видеокурс';
  if (t.includes('онлайн')) return 'Онлайн';
  if (t.includes('в г.') || t.includes('москва')) return 'Очный';
  return 'Онлайн';
}

/** B2B/B2C: КОМ-воронка всегда B2B, иначе — по наличию компании. */
export function detectB2b(d) {
  if (parseInt(d.CATEGORY_ID || 0) === CAT_KOM) return 'B2B';
  const cid = d.COMPANY_ID;
  return (cid && String(cid) !== '0') ? 'B2B' : 'B2C';
}
