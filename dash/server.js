import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, 'cache');
const router = express.Router();

// Статика
router.use(express.static(path.join(__dirname, 'public')));

// API
router.get('/api/data/new', async (req, res) => {
  try {
    const data = JSON.parse(await fs.readFile(path.join(CACHE_DIR, 'agg_new.json'), 'utf-8'));
    res.json(data);
  } catch (e) {
    res.status(503).json({ error: 'Data not ready', details: e.message });
  }
});

// Redirect root to dash
router.get('/', (req, res) => {
  res.redirect('/dash/');
});

export default router;
