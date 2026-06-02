import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3004;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dashboard-files/*', (req, res, next) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

export default app;

// Слушаем порт ТОЛЬКО при прямом вызове node server.js
const thisFile = fileURLToPath(import.meta.url);
const isMain = process.argv[1] === thisFile;
if (isMain) {
  app.listen(PORT, '0.0.0.0', () => console.log(`🍀 Тест-дашборд на http://0.0.0.0:${PORT}`));
}
