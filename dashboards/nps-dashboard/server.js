/**
 * nps-dashboard — NPS (пока пустой каркас).
 * Данных/агрегаций ещё нет: только статика + catch-all.
 * Когда появятся данные — добавить /api/* (при необходимости getAgg из data-service).
 */
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3000', 10);

const app = express();
app.set('etag', false);
app.use(express.json());

app.get('/api/user', (req, res) => {
  res.json({ role: (req.user && req.user.role) || 'guest' });
});

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

app.get(/(.*)/, (req, res) => {
  if (path.extname(req.path)) return res.status(404).end();
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

export default app;

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  app.listen(PORT, '0.0.0.0', () => console.log(`😊 NPS на http://0.0.0.0:${PORT}`));
}
