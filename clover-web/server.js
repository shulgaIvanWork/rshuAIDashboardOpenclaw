import express from 'express';
import session from 'express-session';
import FileStore from 'session-file-store';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
    if (!_appCache[name]) {
      const mod = await importFn();
      _appCache[name] = mod.default;
    }
    _appCache[name](req, res, next);
  };
}

// --------------- App ---------------
const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'clover-web-secret-2026',
  resave: false,
  saveUninitialized: false,
  store: new FileStoreSession({ path: path.join(DATA_DIR, 'sessions') }),
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
  if (!user || !bcrypt.compareSync(password, user.password)) {
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
app.use('/rshu-dashboard',            requireAuth, lazyApp('rshu-dashboard',            () => import('../dashboards/rshu-dashboard/server.js')));
app.use('/kom-dashboard',             requireAuth, lazyApp('kom-dashboard',             () => import('../dashboards/kom-dashboard/server.js')));
app.use('/drop-dashboard',            requireAuth, lazyApp('drop-dashboard',            () => import('../dashboards/drop-dashboard/server.js')));
app.use('/rshu-management-dashboard', requireAuth, lazyApp('rshu-management-dashboard', () => import('../dashboards/rshu-management-dashboard/server.js')));
app.use('/ratings-dashboard',         requireAuth, lazyApp('ratings-dashboard',         () => import('../dashboards/ratings-dashboard/server.js')));
app.use('/participants-dashboard',    requireAuth, lazyApp('participants-dashboard',    () => import('../dashboards/participants-dashboard/server.js')));
app.use('/test-dashboard',            requireAuth, lazyApp('test-dashboard',            () => import('../dashboards/test-dashboard/server.js')));
app.use('/manager-report-dev',        requireAuth, lazyApp('manager-report-dev',        () => import('../dashboards/manager-report-dev/server.js')));

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
    users: users.map(u => ({ id: u.id, name: u.name, role: u.role, dashboards: u.dashboards, avatar: u.avatar })),
    dashboards: allDashboards,
    dashboardsMeta
  });
});

// API: список пользователей
app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = loadUsers();
  res.json(users.map(u => ({ id: u.id, name: u.name, role: u.role, dashboards: u.dashboards, avatar: u.avatar })));
});

// API: создать пользователя
app.post('/api/admin/users', requireAdmin, async (req, res) => {
  const { id, name, role, dashboards } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id и name обязательны' });
  if (id.length < 2) return res.status(400).json({ error: 'id должен быть минимум 2 символа' });
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return res.status(400).json({ error: 'id: только буквы, цифры, -, _' });

  const users = loadUsers();
  if (users.find(u => u.id === id)) return res.status(409).json({ error: 'Пользователь с таким id уже существует' });

  const rawPassword = generatePassword();
  const password = await bcrypt.hash(rawPassword, 10);
  const newUser = {
    id,
    name,
    password,
    role: role === 'admin' ? 'admin' : 'guest',
    avatar: role === 'admin' ? '👨‍💻' : '👤',
    dashboards: role !== 'admin' && dashboards ? dashboards : undefined
  };
  users.push(newUser);
  saveUsers(users);
  console.log(`👤 Created user: ${id} (${newUser.role})`);

  res.json({ ok: true, user: { ...newUser, password: undefined }, generatedPassword: rawPassword });
});

// API: обновить пользователя
app.put('/api/admin/users/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, newPassword, role, dashboards } = req.body;
  const users = loadUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Пользователь не найден' });

  if (name) users[idx].name = name;
  if (newPassword) {
    users[idx].password = await bcrypt.hash(newPassword, 10);
    console.log(`🔑 Password updated for ${id}`);
  }
  if (role) users[idx].role = role === 'admin' ? 'admin' : 'guest';
  if (dashboards !== undefined) {
    users[idx].dashboards = role === 'admin' ? undefined : (dashboards.length > 0 ? dashboards : undefined);
  }
  // Админам не нужен персональный список
  if (users[idx].role === 'admin') delete users[idx].dashboards;

  saveUsers(users);
  console.log(`👤 Updated user: ${id}`);
  res.json({ ok: true, user: { ...users[idx], password: undefined } });
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

// --------------- Dashboard files (static) ---------------
app.use('/dashboard-files', requireAuth, express.static(PROJECTS_DIR, {
  index: false,
  dotfiles: 'deny'
}));

// --------------- Views ---------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --------------- Start ---------------
app.listen(PORT, '127.0.0.1', () => {
  console.log('📊 РШУ дашборды на http://0.0.0.0:' + PORT);
  console.log('   Логины: ivan, olga, anastasia');
  console.log('   Пароли: {логин}123');
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
    'manager-report-dev': { url: '/manager-report-dev/' }
  };

  try {
    const entries = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      if (entry.name.startsWith('.') || entry.name === 'web-interface' || entry.name === 'dashboard2') continue;

      const meta = getDashboardStatus(entry.name);

      // Админы видят всё, гости — только из своего списка
      if (!isAdmin && allowedDashboards.length > 0) {
        if (!allowedDashboards.includes(entry.name)) continue;
      }

      if (knownProjects[entry.name]) {
        const kp = knownProjects[entry.name];
        dashboards.push({
          name: entry.name,
          description: meta ? meta.label : entry.name,
          icon: meta ? meta.icon : '📁',
          url: kp.url
        });
        continue;
      }

      const dirPath = path.join(PROJECTS_DIR, entry.name);
      const files = fs.readdirSync(dirPath);
      const htmlFiles = files.filter(f => f.endsWith('.html'));
      if (htmlFiles.length > 0 || files.includes('package.json')) {
        let desc = 'Проект';
        ['README.md', 'README.txt'].forEach(r => {
          const rp = path.join(dirPath, r);
          if (fs.existsSync(rp)) {
            const firstLine = fs.readFileSync(rp, 'utf-8').split('\n')[0].replace(/^#\s*/, '');
            if (firstLine) desc = firstLine;
          }
        });
        dashboards.push({
          name: entry.name,
          description: desc,
          icon: htmlFiles.length > 0 ? '📊' : '📁',
          url: '/dashboard-files/' + entry.name + '/'
        });
      }
    }
  } catch (e) { console.error('Error scanning dashboards:', e.message); }
  return dashboards;
}
