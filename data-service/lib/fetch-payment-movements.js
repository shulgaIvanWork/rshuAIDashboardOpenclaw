/**
 * Выгрузка фактических поступлений из смарт-процессов Bitrix24.
 *
 * 1044 (движение) -> parentId1048 -> 1048 (контроль) -> parentId2 -> сделка.
 * В дашборд передаются только операции «Оплата» (enum 36297). Возвраты не
 * являются поступлениями и намеренно не попадают в результат.
 */

const WEBHOOK = process.env.BITRIX_BASE;
const CONTROL_ENTITY = 1048;
const MOVEMENT_ENTITY = 1044;
const PAYMENT_TYPE = 36297;

async function restCall(method, params) {
  const res = await fetch(WEBHOOK + method + '.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(json.error_description || json.error || `HTTP ${res.status}`);
  return json;
}

async function fetchAll(entityTypeId) {
  const items = [];
  let start = 0;
  while (true) {
    const response = await restCall('crm.item.list', {
      entityTypeId,
      order: { id: 'ASC' },
      start,
    });
    items.push(...(response.result?.items || []));
    if (response.next == null) break;
    start = response.next;
  }
  return items;
}

export async function fetchPaymentMovements() {
  const [controls, movements] = await Promise.all([
    fetchAll(CONTROL_ENTITY),
    fetchAll(MOVEMENT_ENTITY),
  ]);
  const dealByControl = new Map(
    controls
      .filter(x => Number(x.parentId2) > 0)
      .map(x => [Number(x.id), String(x.parentId2)])
  );

  const payments = [];
  const rejected = [];
  for (const movement of movements) {
    if (Number(movement.ufCrm13_1789629647941) !== PAYMENT_TYPE) continue;
    const controlId = Number(movement.parentId1048 || 0);
    const dealId = dealByControl.get(controlId);
    const amount = Number(movement.ufCrm13_1789631137 || 0);
    const date = String(movement.ufCrm13_1789629599875 || '').slice(0, 10);
    if (!dealId || !(amount > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      rejected.push({ movementId: movement.id, controlId, dealId: dealId || null, amount, date });
      continue;
    }
    payments.push({
      movementId: Number(movement.id),
      controlId,
      dealId,
      date,
      amount,
    });
  }

  return {
    fetchedAt: new Date().toISOString(),
    controlsCount: controls.length,
    movementsCount: movements.length,
    payments,
    rejected,
  };
}
