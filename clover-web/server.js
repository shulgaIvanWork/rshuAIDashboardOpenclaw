import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import session from 'express-session';
import FileStore from 'session-file-store';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const DASHBOARDS_FILE = path.join(DATA_DIR, 'dashboards.json');
const PROJECTS_DIR = path.resolve(__dirname, '../dashboards');

// Загружаем пользователей (перечитывать при каждом запросе, чтобы видеть изменения)
function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8')); }
  catch(e) { return []; }
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 4));
}

const FileStoreSession = FileStore(session);

// --------------- Lazy sub-app loader ---------------
// Каждый дашборд загружается при первом обращении, а не при старте сервера
const _appCache = {};
function lazyApp(name, importFn) {
  return async (req, res, next) => {
    try {
      if (!_appCache[name]) {
        const mod = await importFn();
        _appCache[name] = mod.default;
      }
      _appCache[name](req, res, next);
    } catch (e) {
      console.error(`lazyApp(${name}) error:`, e.message);
      next(e);
    }
  };
}

// --------------- App ---------------
const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'clover-web-secret-2026',
  resave: false,
  saveUninitialized: false,
  store: new FileStoreSession({ path: path.join(DATA_DIR, 'sessions'), logFn: () => {} }),
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, 'public')));

// Auth middleware
function requireAuth(req, res, next) {
  if (req.session.userId) {
    req.user = getUserById(req.session.userId);
    return next();
  }
  res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (req.session.userId && req.session.userRole === 'admin') {
    req.user = getUserById(req.session.userId);
    return next();
  }
  res.redirect('/dashboards');
}

// Проверка доступа к конкретному дашборду: админ — ко всем; гость — только к тем,
// что явно перечислены в его списке (пустой список = нет доступа). Закрывает дыру,
// когда гость открывал любой дашборд по прямой ссылке в обход списка.
function requireDashboardAccess(name) {
  return (req, res, next) => {
    const user = req.session.userId ? getUserById(req.session.userId) : null;
    if (!user) return res.redirect('/login');
    req.user = user;
    if (user.role === 'admin') return next();
    const allowed = Array.isArray(user.dashboards) ? user.dashboards : [];
    if (allowed.includes(name)) return next();
    return res.redirect('/dashboards');
  };
}

// --------------- Root redirect ---------------
app.get('/', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboards');
  res.redirect('/login');
});

// --------------- Auth ---------------
app.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboards');
  res.render('login.ejs', { error: null });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const users = loadUsers();
  const user = users.find(u => u.id === username);
  if (!user || !verifyPassword(password, user.password)) {
    return res.render('login.ejs', { error: 'Неверный логин или пароль' });
  }
  req.session.userId = user.id;
  req.session.userName = user.name;
  req.session.userRole = user.role;
  res.redirect("/dashboards");
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// --------------- Mount dashboards (with auth, lazy-loaded) ---------------
app.use('/rshu-dashboard',            requireDashboardAccess('rshu-dashboard'),            lazyApp('rshu-dashboard',            () => import('../dashboards/rshu-dashboard/server.js')));
app.use('/kom-dashboard',             requireDashboardAccess('kom-dashboard'),             lazyApp('kom-dashboard',             () => import('../dashboards/kom-dashboard/server.js')));
app.use('/drop-dashboard',            requireDashboardAccess('drop-dashboard'),            lazyApp('drop-dashboard',            () => import('../dashboards/drop-dashboard/server.js')));
app.use('/rshu-management-dashboard', requireDashboardAccess('rshu-management-dashboard'), lazyApp('rshu-management-dashboard', () => import('../dashboards/rshu-management-dashboard/server.js')));
app.use('/ratings-dashboard',         requireDashboardAccess('ratings-dashboard'),         lazyApp('ratings-dashboard',         () => import('../dashboards/ratings-dashboard/server.js')));
app.use('/participants-dashboard',    requireDashboardAccess('participants-dashboard'),    lazyApp('participants-dashboard',    () => import('../dashboards/participants-dashboard/server.js')));
app.use('/test-dashboard',            requireDashboardAccess('test-dashboard'),            lazyApp('test-dashboard',            () => import('../dashboards/test-dashboard/server.js')));
app.use('/manager-report-dev',        requireDashboardAccess('manager-report-dev'),        lazyApp('manager-report-dev',        () => import('../dashboards/manager-report-dev/server.js')));
app.use('/plan-fact-dashboard',       requireDashboardAccess('plan-fact-dashboard'),       lazyApp('plan-fact-dashboard',       () => import('../dashboards/plan-fact-dashboard/server.js')));
app.use('/nps-dashboard',             requireDashboardAccess('nps-dashboard'),             lazyApp('nps-dashboard',             () => import('../dashboards/nps-dashboard/server.js')));

// --------------- Dashboards page ---------------
app.get('/dashboards', requireAuth, (req, res) => {
  const dashboards = getAvailableDashboards(req.user);
  res.render('dashboards.ejs', {
    user: { id: req.user.id, name: req.user.name, role: req.user.role },
    dashboards,
    _dashboardsMeta: getAllDashboardsMeta()
  });
});

app.get('/api/dashboards', requireAuth, (req, res) => {
  res.json(getAvailableDashboards(req.user));
});



// --------------- Admin panel ---------------
app.get('/admin', requireAdmin, (req, res) => {
  const users = loadUsers();
  const dashboardsMeta = getAllDashboardsMeta();
  const allDashboards = Object.entries(getAllDashboardsMeta()).map(([name, m]) => ({ name, label: m.label || name }));
  res.render('admin.ejs', {
    user: { id: req.user.id, name: req.user.name },
    // password: открытый текст для показа админу; null — старый хеш (не показать)
    users: users.map(u => ({ id: u.id, name: u.name, role: u.role, dashboards: u.dashboards, avatar: u.avatar, password: passwordForDisplay(u.password) })),
    dashboards: allDashboards,
    dashboardsMeta
  });
});

// API: список пользователей (админ видит пароли)
app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = loadUsers();
  res.json(users.map(u => ({ id: u.id, name: u.name, role: u.role, dashboards: u.dashboards, avatar: u.avatar, password: passwordForDisplay(u.password) })));
});

// API: создать пользователя
app.post('/api/admin/users', requireAdmin, (req, res) => {
  const { id, name, role, dashboards, password } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id и name обязательны' });
  if (id.length < 2) return res.status(400).json({ error: 'id должен быть минимум 2 символа' });
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return res.status(400).json({ error: 'id: только буквы, цифры, -, _' });

  const users = loadUsers();
  if (users.find(u => u.id === id)) return res.status(409).json({ error: 'Пользователь с таким id уже существует' });

  // Пароль: заданный админом или сгенерированный. Хранится открытым текстом.
  const rawPassword = (password && String(password).trim()) ? String(password).trim() : generatePassword();
  const isGuest = role !== 'admin';
  const newUser = {
    id,
    name,
    password: rawPassword,
    role: isGuest ? 'guest' : 'admin',
    avatar: isGuest ? '👤' : '👨💻',
    dashboards: isGuest && Array.isArray(dashboards) && dashboards.length ? dashboards : undefined
  };
  users.push(newUser);
  saveUsers(users);
  console.log(`👤 Created user: ${id} (${newUser.role})`);

  res.json({ ok: true, user: { ...newUser }, generatedPassword: rawPassword });
});

// API: обновить пользователя
app.put('/api/admin/users/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { name, newPassword, resetPassword, role, dashboards } = req.body;
  const users = loadUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Пользователь не найден' });

  if (name) users[idx].name = name;

  // Пароль хранится открытым текстом. resetPassword — сгенерировать на сервере.
  let generatedPassword;
  if (resetPassword) {
    generatedPassword = generatePassword();
    users[idx].password = generatedPassword;
    console.log(`🔑 Password reset for ${id}`);
  } else if (newPassword && String(newPassword).trim()) {
    users[idx].password = String(newPassword).trim();
    console.log(`🔑 Password changed for ${id}`);
  }

  if (role) users[idx].role = role === 'admin' ? 'admin' : 'guest';
  if (dashboards !== undefined) {
    users[idx].dashboards = users[idx].role === 'admin'
      ? undefined
      : (Array.isArray(dashboards) && dashboards.length ? dashboards : undefined);
  }
  // Админам не нужен персональный список
  if (users[idx].role === 'admin') delete users[idx].dashboards;

  saveUsers(users);
  console.log(`👤 Updated user: ${id}`);
  res.json({ ok: true, user: { ...users[idx], password: passwordForDisplay(users[idx].password) }, generatedPassword });
});

// API: удалить пользователя
app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  let users = loadUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Пользователь не найден' });
  if (users[idx].role === 'admin') return res.status(403).json({ error: 'Нельзя удалить админа' });

  users = users.filter(u => u.id !== id);
  saveUsers(users);
  console.log(`👤 Deleted user: ${id}`);
  res.json({ ok: true });
});

// --------------- Views ---------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --------------- Global error handler ---------------
// Перехватывает необработанные ошибки из дашбордов и возвращает JSON,
// а не HTML-страницу ошибки — иначе фронтенд делает редирект на /login → /dashboards
app.use((err, req, res, next) => {
  console.error('[error]', req.method, req.path, err.message);
  if (res.headersSent) return next(err);
  res.status(503).json({ error: 'Временная ошибка сервера', detail: err.message });
});

// --------------- Start ---------------
app.listen(PORT, '127.0.0.1', () => {
  console.log('📊 РШУ дашборды на http://127.0.0.1:' + PORT);
  if (!process.env.SESSION_SECRET) {
    console.warn('⚠️  SESSION_SECRET не задан в .env — используется дефолтный (небезопасно)');
  }
});

// ============== Helpers ==============

function getUserById(id) {
  const users = loadUsers();
  return users.find(u => u.id === id) || null;
}

function generatePassword(length = 10) {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let pwd = '';
  for (let i = 0; i < length; i++) {
    pwd += chars[crypto.randomInt(chars.length)];
  }
  return pwd;
}

// Пароли хранятся открытым текстом (внутренний инструмент, users.json в .gitignore) —
// чтобы админы могли их видеть и менять. Старые аккаунты остались с bcrypt-хешем:
// логин по ним работает через bcrypt, но «посмотреть» их нельзя, пока не сбросят.
function isHashed(stored) { return typeof stored === 'string' && stored.startsWith('$2'); }
function verifyPassword(plain, stored) {
  if (stored == null) return false;
  return isHashed(stored) ? bcrypt.compareSync(plain, stored) : plain === stored;
}
// Что показать админу: открытый пароль или null (для старых хешей — не показываем)
function passwordForDisplay(stored) { return isHashed(stored) ? null : (stored || ''); }

// ============== Dashboard meta & status ==============

function readDashboardsMeta() {
  try {
    return JSON.parse(fs.readFileSync(DASHBOARDS_FILE, 'utf-8'));
  } catch (e) {
    console.error('Failed to read dashboards.json:', e.message);
    return {};
  }
}

function writeDashboardsMeta(meta) {
  fs.writeFileSync(DASHBOARDS_FILE, JSON.stringify(meta, null, 2));
}

function getAllDashboardsMeta() {
  return readDashboardsMeta();
}

function getDashboardStatus(name) {
  const meta = readDashboardsMeta();
  return meta[name] || null;
}

function getAvailableDashboards(user) {
  const dashboards = [];
  const isAdmin = user.role === 'admin';
  const allowedDashboards = user.dashboards || [];
  const knownProjects = {
    'rshu-dashboard': { url: '/rshu-dashboard/' },
    'drop-dashboard': { url: '/drop-dashboard/' },
    'rshu-management-dashboard': { url: '/rshu-management-dashboard/' },
    'ratings-dashboard': { url: '/ratings-dashboard/' },
    'kom-dashboard': { url: '/kom-dashboard/' },
    'participants-dashboard': { url: '/participants-dashboard/' },
    'test-dashboard': { url: '/test-dashboard/' },
    'manager-report-dev': { url: '/manager-report-dev/' },
    'plan-fact-dashboard': { url: '/plan-fact-dashboard/' },
    'nps-dashboard': { url: '/nps-dashboard/' }
  };

  try {
    const entries = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      if (entry.name.startsWith('.') || entry.name === 'web-interface' || entry.name === 'dashboard2') continue;

      const meta = getDashboardStatus(entry.name);

      // Админы видят всё; гости — только явно перечисленные (пустой список = ничего)
      if (!isAdmin && !allowedDashboards.includes(entry.name)) continue;

      if (knownProjects[entry.name]) {
        const kp = knownProjects[entry.name];
        dashboards.push({
          name: entry.name,
          description: meta ? meta.label : entry.name,
          icon: meta ? meta.icon : '📁',
          url: kp.url
        });
      }
      // Папки вне knownProjects не показываем — новый дашборд нужно
      // зарегистрировать в knownProjects и смонтировать выше.
    }
  } catch (e) { console.error('Error scanning dashboards:', e.message); }
  return dashboards;
}