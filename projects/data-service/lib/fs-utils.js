/**
 * fs-utils.js — общие файловые утилиты data-service.
 */
import { writeFile, rename } from 'fs/promises';

/**
 * Атомарная запись: пишем во временный файл и переименовываем.
 * Иначе analyze() мог прочитать полузаписанный JSON во время
 * 20-40-минутной выгрузки (rename на одном диске атомарен).
 */
export async function writeFileAtomic(filePath, data) {
  const tmp = filePath + '.tmp';
  await writeFile(tmp, data, 'utf-8');
  await rename(tmp, filePath);
}
