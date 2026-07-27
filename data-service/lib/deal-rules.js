/**
 * deal-rules.js — ЕДИНЫЙ источник бизнес-правил для сделок Bitrix24.
 */

export const YEAR = parseInt(process.env.RSHU_YEAR || '', 10) || new Date().getFullYear();
export const MIN_OPP = 11.0;

export const UF = {
  PAY_DATE_1C:       'UF_DATE_PAY_1C',
  FORMAT:            'UF_FORMAT',
  DIRECTION:         'UF_CRM_1498466811',
  KOM_FLAG:          'UF_CRM_1683882427069',
  EDU_TYPE:          'UF_CRM_1765896709800',
  INVOICE_SENT_DATE: 'UF_CRM_1753272713011',
  REFUSE_DATE:       'UF_CRM_1753341391806',
  LEARN_START:       'UF_CRM_DATE_START_LEARN',
  LEARN_END:         'UF_CRM_DATE_END_LEARN',
  PRODUCT_NAME:      'UF_CRM_1697096074',
  NPS_SCORE:         'UF_CRM_1703146018908',
  NPS_CATEGORY:      'UF_CRM_1701751401798',
  NPS_COMMENT:       'UF_CRM_1701751424430',
  POSTSALE_SRC_ID:   'UF_CRM_1701931306730',
  LEARNER_STATUS:    'UF_CRM_5DF2528C641D4',
  DIRECTION_CREATED: 'UF_CRM_1744273716729',
  AGREED_PAY_DATE:   'UF_CRM_1474975772',
  DEAL_DOCUMENTS:    'UF_CRM_1519917152',
  PARTICIPANT_FLAG:  'UF_CRM_1477555902',
  INVOICE_DISCOUNT:  'UF_DISCOUNT',
};

export const CAT_SALE     = 0;
export const CAT_PRESALE  = 8;
export const CAT_POSTSALE = 9;
export const CAT_KOM      = 19;
export const VALID_CATS = new Set([CAT_SALE, CAT_PRESALE, CAT_KOM]);

export const KOM_FORMAT_ID    = '19042498';
export const KOM_DIRECTION_ID = '1906';
export const KOM_TRAINING_ID  = '34765';

export const REG_SRC_ID = '79641902890';
export const INTERNAL_SOURCE_IDS = new Set([
  '79641902894','79641902977','79641902926','UC_7G65N9','79641902903','RECOMMENDATION',
]);
export const MBA_DIRECTION_IDS = new Set(['1917', '35288']);

export const POSTSALE_SENT_STAGES = new Set([
  'UC_EPPAPR','UC_0Z9C0Q','UC_UJ3AGH','UC_9N3TCX','1','WON','LOSE',
]);
export const POSTSALE_FILLED_STAGES = new Set([
  'UC_9N3TCX','1','WON',
]);

export const LEARNER_STATUS = {
  PROMOTER: '12588', PASSIVE: '12589', DETRACTOR: '12590', NO_CONTACT: '21747',
};
export const LEARNER_STATUS_FILLED = new Set([
  LEARNER_STATUS.PROMOTER, LEARNER_STATUS.PASSIVE, LEARNER_STATUS.DETRACTOR,
]);

export const MQL_SALE_STAGES = new Set(['UC_4RJOR4','DETAILS','PROPOSAL','2','6','WON','LOSE','UC_F2YC3N','UC_VKPN0N','UC_W6SCHG','UC_670ME2']);
export const NOT_MQL_SALE = new Set(['NEW','UC_1YW3V2','UC_STZB49','UC_838R2R']);
export const SQL_STAGES = ['DETAILS','PROPOSAL','2','6','WON'];

export const EDU_TYPE_MAP = {
  '34699':'Повышение квалификации','34700':'Проф. переподготовка','34765':'Корпоративное обучение',
};
export const FORMAT_MAP = {
  '19042467':'Очный','19042468':'Онлайн','19042469':'Видеокурс',
  '19042498':'Корпоративное обучение','19042495':'MMBA','19042497':'Вечерний','19042496':'ГК',
};

export function getOpp(d) { return parseFloat(d.OPPORTUNITY || 0); }

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

export function isPaidDeal(d) {
  return !!d[UF.PAY_DATE_1C] && getOpp(d) >= MIN_OPP;
}

export function isMqlDeal(d) {
  const cat = parseInt(d.CATEGORY_ID || 0);
  if (!VALID_CATS.has(cat)) return false;
  const stage = String(d.STAGE_ID || '').replace(/^C\d+:/, '');
  if (d.STAGE_SEMANTIC_ID === 'S' && getOpp(d) < MIN_OPP) return false;
  if (cat === CAT_SALE) return NOT_MQL_SALE.has(stage) ? false : MQL_SALE_STAGES.has(stage);
  if (cat === CAT_KOM)  return !(d.STAGE_SEMANTIC_ID === 'S' || d.STAGE_SEMANTIC_ID === 'F');
  return false;
}

export function isInternalSource(srcId) {
  return srcId ? INTERNAL_SOURCE_IDS.has(String(srcId)) : false;
}

export function detectFormat(title, ufFormat) {
  if (ufFormat && FORMAT_MAP[String(ufFormat)]) return FORMAT_MAP[String(ufFormat)];
  const t = (title || '').toLowerCase();
  if (t.includes('(сдо)') || t.includes(' сдо') || t.endsWith('сдо')) return 'Видеокурс';
  if (t.includes('онлайн')) return 'Онлайн';
  if (t.includes('в г.') || t.includes('москва')) return 'Очный';
  return 'Онлайн';
}

export function detectB2b(d) {
  if (parseInt(d.CATEGORY_ID || 0) === CAT_KOM) return 'B2B';
  const cid = d.COMPANY_ID;
  return (cid && String(cid) !== '0') ? 'B2B' : 'B2C';
}
