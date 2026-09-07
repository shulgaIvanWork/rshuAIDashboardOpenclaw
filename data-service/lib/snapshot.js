/**
 * snapshot.js — ежедневный снапшот портфеля для восстановления прошлых состояний.
 *
 * Зачем: разбивка «Остатка на конец» по этапам (до MQL / MQL / SQL / Счёт) для
 * прошлых дат достоверно невосстановима из текущей выгрузки (нет истории стадий).
 * Чтобы со временем закрыть это — каждый fetch сохраняет состояние «в работе»:
 *   cache/snapshots/YYYY-MM-DD.json  (перезаписывается при повторном fetch того же дня)
 *
 * Запись: { id, date, category_id, stage_id, stage_semantic_id, assigned_by_id, opportunity }
 * «В работе» на дату D = кат.0 (воронка Sale, как в portfolio-flow.js),
 * создана ≤ D, не оплачена ≤ D (1С ≥ MIN_OPP),
 * не отказана ≤ D (дата отказа, при пустой у LOSE — CLOSEDATE), не технический WON,
 * не WON-без-1С, не тех. зачистка (массовое закрытие — см. portfolio-flow.js).
 *
 * Вызывается в конце npm run fetch (index.js). Дата снимка = дата fetched_at
 * (консистентно с кэшем: все даты в выгрузке — в этом же срезе).
 */
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAP_DIR = path.join(__dirname, '..', 'cache', 'snapshots');

function parseDt(s) {
  if (!s) return null;
  let m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = String(s).match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  return null;
}
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const MIN_OPP = 11;

/** Собрать записи «в работе» на дату D из массива сделок. */
export function collectSnapshot(dealsRaw, dateISO) {
  const D = parseDt(dateISO);
  if (!D) throw new Error('snapshot: неверная дата ' + dateISO);
  const seen = new Set();
  const out = [];
  for (const x of dealsRaw) {
    const id = String(x.ID);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const cat = String(x.CATEGORY_ID || '');
    if (cat !== '0') continue;                 // только воронка Sale
    const sem = x.STAGE_SEMANTIC_ID || '';
    const opp = parseFloat(x.OPPORTUNITY || 0);
    if (sem === 'S' && opp < MIN_OPP) continue;             // тех. WON
    const pay = parseDt(x.UF_DATE_PAY_1C);
    if (sem === 'S' && !pay) continue;                      // WON без 1С — вне портфеля
    const dc = parseDt(x.DATE_CREATE);
    if (!dc || dc > D) continue;                            // создана ≤ D
    if (pay && pay <= D && opp >= MIN_OPP) continue;        // оплачена ≤ D
    const ref = parseDt(x.UF_CRM_1753341391806);
    const effRefuse = ref || (sem === 'F' ? parseDt(x.CLOSEDATE) : null);
    if (effRefuse && effRefuse <= D) continue;              // отказана ≤ D
    out.push({
      id,
      date: dateISO,
      category_id: cat,
      stage_id: String(x.STAGE_ID || ''),
      stage_semantic_id: sem,
      assigned_by_id: String(x.ASSIGNED_BY_ID || ''),
      opportunity: opp,
    });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

/** Сохранить снапшот дня (перезапись при повторе). Возвращает число записей. */
export function saveDailySnapshot(dealsRaw, dateISO) {
  const rows = collectSnapshot(dealsRaw, dateISO);
  mkdirSync(SNAP_DIR, { recursive: true });
  const file = path.join(SNAP_DIR, dateISO + '.json');
  writeFileSync(file, JSON.stringify(rows));
  return rows.length;
}

/** Прочитать снапшот на дату (null, если нет). */
export function readSnapshot(dateISO) {
  try {
    return JSON.parse(readFileSync(path.join(SNAP_DIR, dateISO + '.json'), 'utf-8'));
  } catch {
    return null;
  }
}

export const snapshotDir = SNAP_DIR;
