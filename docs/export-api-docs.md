# CRM Export API для ИИ-агентов

**Эндпоинт:** https://24.uprav.ru/web_services/crm/export.php
**Secret key:** `14b0fc053c141e47a5974b3859f5753f`
**Дата получения:** 06.06.2026
**Источник:** ИТ-отдел, для ИИ-агентов

## Общий формат запроса

Метод: `POST`
Content-Type: `application/x-www-form-urlencoded`

Обязательные параметры: `secret`, `action` (getDeals|getFormats|getDirections|getUserFieldsCrm), `data` (array)

Стандартный ответ: `{"success": true, "data": {}, "errors": []}`
Ошибка: `{"success": false, "data": null, "errors": [{"code": "...", "message": "..."}]}`

---

## action=getDeals

Возвращает список сделок CRM с безопасной пагинацией и обогащением.

### Параметры data
- `SORT` — поля: ID, DATE_CREATE, DATE_MODIFY, BEGINDATE, CLOSEDATE, STAGE_ID, CATEGORY_ID
- `FILTER` — поля: ID, CATEGORY_ID, STAGE_ID, ASSIGNED_BY_ID, CONTACT_ID, COMPANY_ID, DATE_CREATE, DATE_MODIFY, BEGINDATE, CLOSEDATE, UF_FORMAT, UF_CRM_*
- `SELECT` — безопасный набор по умолчанию, `*` и `UF_*` запрещены
- `nav` — `{limit: 10, offset: 0}` (limit ≤ 50, offset ≤ 5000)
- `WITH_PRODUCTS` — `Y`/`N` (по умолч. N, для limit ≤ 5)

### Обогащение
- `CATEGORY_NAME` — название воронки (категории)
- `STAGE_NAME` — название стадии
- `FORMAT_NAME` — название формата (из UF_FORMAT)
- `DIRECTION` — объект направления (из UF_CRM_1498466811)
- `CONTACT` — {NAME, LAST_NAME, SECOND_NAME, POST, ID, FULL_NAME}
- `COMPANY` — {ID, TITLE}

### WITH_PRODUCTS=Y
Добавляет блок `PRODUCTS` с товарами и модулями.

---

## action=getFormats
Справочник форматов из инфоблока 149.

## action=getDirections
Справочник направлений из UF_CRM_1498466811.

## action=getUserFieldsCrm
Все пользовательские поля сделок CRM.

---

## Ограничения
- limit ≤ 50, offset ≤ 5000
- SELECT: `*` и `UF_*` запрещены
- WITH_PRODUCTS=Y — только при необходимости, с limit ≤ 5
- При ошибке `invalid_key` не повторять бесконечно
- При пустом `nextOffset` — следующей страницы нет
