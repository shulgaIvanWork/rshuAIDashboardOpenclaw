/**
 * export-excel.js — выгрузка таблиц участников в один .xlsx (2 листа).
 *
 * Колонки повторяют таблицу на фронтенде (buildParticipantsTable в public/app.js).
 */
import ExcelJS from 'exceljs';

const COLUMNS = [
  { header: 'Направление', key: 'direction', width: 18 },
  { header: 'Программа', key: 'program', width: 28 },
  { header: 'Формат', key: 'format', width: 10 },
  { header: 'ФИО', key: 'participant', width: 22 },
  { header: 'Регион', key: 'region', width: 14 },
  { header: 'Компания', key: 'company', width: 28 },
  { header: 'Тип', key: 'clientType', width: 8 },
  { header: 'Сумма, ₽', key: 'amount', width: 12 },
  { header: 'Начало', key: 'date', width: 12 },
  { header: 'Конец', key: 'dateEnd', width: 12 },
  { header: 'Длит., дн.', key: 'moduleDuration', width: 10 },
  { header: 'Цикл, дн.', key: 'dealCycle', width: 10 },
  { header: 'Статус', key: 'stage', width: 16 },
  { header: 'Пред. обучение', key: 'prevTrainingDate', width: 14 },
  { header: 'Посл. обучение (комп.)', key: 'lastCompanyTraining', width: 16 },
  { header: 'Участник', key: 'participantFlag', width: 10 },
  { header: 'Скидка, %', key: 'invoiceDiscount', width: 10 },
  { header: 'Статус счета', key: 'invoiceStatus', width: 16 },
];

function addSheet(workbook, sheetName, participants) {
  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = COLUMNS;
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF093EB4' } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  for (const p of participants) {
    sheet.addRow({
      direction: p.direction || '—',
      program: p.program,
      format: p.format,
      participant: p.participant,
      region: p.region || '—',
      company: p.company,
      clientType: p.clientType || '—',
      amount: p.amount || 0,
      date: p.date || '—',
      dateEnd: p.dateEnd || '—',
      moduleDuration: p.moduleDuration != null ? p.moduleDuration : '—',
      dealCycle: p.dealCycle != null ? p.dealCycle : '—',
      stage: p.stage,
      prevTrainingDate: p.hadPrevTraining ? (p.prevTrainingDate || 'Да') : 'нет',
      lastCompanyTraining: p.lastCompanyTraining || '—',
      participantFlag: p.participantFlag || '—',
      invoiceDiscount: p.invoiceDiscount != null ? p.invoiceDiscount : '—',
      invoiceStatus: p.invoiceStatus || '—',
    });
  }

  sheet.autoFilter = { from: 'A1', to: { row: 1, column: COLUMNS.length } };
}

/**
 * Строит книгу из двух наборов participants (прошлая и текущая неделя)
 * и возвращает Buffer с .xlsx.
 */
export async function buildParticipantsWorkbook(prevResult, curResult) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'RSHU Dashboard';
  workbook.created = new Date();

  addSheet(workbook, 'Прошлая неделя', prevResult.participants || []);
  addSheet(workbook, 'Текущая неделя', curResult.participants || []);

  return workbook.xlsx.writeBuffer();
}
