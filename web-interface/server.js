const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const http = require('http');
// Dashboard sub-apps loaded dynamically (ESM)

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const DIALOGS_DIR = path.join(DATA_DIR, 'dialogs');
const DASHBOARDS_FILE = path.join(DATA_DIR, 'dashboards.json');
const PROJECTS_DIR = path.join(__dirname, '..');

const USERS = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));

// Gateway config — читаем токен из конфига OpenClaw
const GATEWAY_HOST = '127.0.0.1';
const GATEWAY_PORT = 18789;
const GATEWAY_TOKEN = (function() {
  try {
    const cfg = JSON.parse(fs.readFileSync('/root/.openclaw/openclaw.json', 'utf-8'));
    return cfg.gateway?.auth?.token || '';
  } catch (e) {
    console.error('Failed to read gateway token:', e.message);
    return '';
  }
})();

// --------------- Middleware ---------------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'clover-web-secret-2026',
  resave: false,
  saveUninitialized: false,
  store: new FileStore({ path: path.join(DATA_DIR, 'sessions') }),
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, 'public')));

function requireAuth(req, res, next) {
  if (req.session.userId) return next();
  res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (req.session.userId && req.session.userRole === 'admin') return next();
  res.redirect('/dashboards');
}

// --------------- Root redirect ---------------
app.get('/', (req, res) => {
  if (req.session.userId) {
    if (req.session.userRole === 'admin') return res.redirect('/chat');
    return res.redirect('/dashboards');
  }
  res.redirect('/login');
});

// --------------- Auth ---------------
app.get('/login', (req, res) => {
  if (req.session.userId) {
    if (req.session.userRole === 'admin') return res.redirect('/chat');
    return res.redirect('/dashboards');
  }
  res.render('login.ejs', { error: null });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = USERS.find(u => u.id === username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.render('login.ejs', { error: 'Неверный логин или пароль' });
  }
  req.session.userId = user.id;
  req.session.userName = user.name;
  req.session.userRole = user.role;
  if (user.role === 'admin') return res.redirect('/chat');
  res.redirect('/dashboards');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// --------------- Dashboard Sub-apps (no separate ports) ---------------
async function mountDashboards() {
  const dashboardApps = [
    { path: '/rshu-dashboard', file: '../rshu-dashboard/server.js' },
    { path: '/kom-dashboard',  file: '../kom-dashboard/server.js' },
    { path: '/drop-dashboard', file: '../drop-dashboard/server.js' },
    { path: '/test-dashboard', file: '../test-dashboard/server.js' },
  ];
  for (const d of dashboardApps) {
    try {
      const mod = await import(d.file);
      const subApp = mod.default || mod;
      app.use(d.path, requireAuth, subApp);
      console.log(`✅ Mounted ${d.path}`);
    } catch (e) {
      console.error(`❌ Failed to mount ${d.path}:`, e.message);
    }
  }
}

// --------------- Chat ---------------
app.get('/chat', requireAdmin, (req, res) => {
  const user = getCurrentUser(req);
  let dialogs = getUserDialogs(user.id);
  const currentDialogId = req.query.dialog || (dialogs.length > 0 ? dialogs[0].id : null);
  const messages = currentDialogId ? getDialogMessages(user.id, currentDialogId) : [];
  const currentDialog = dialogs.find(d => d.id === currentDialogId);

  res.render('chat.ejs', {
    user: { id: user.id, name: user.name },
    dialogs,
    currentDialog: currentDialogId,
    currentDialogTitle: currentDialog ? currentDialog.title : '',
    messages
  });
});

// --------------- Dashboards ---------------
app.get('/dashboards', requireAuth, (req, res) => {
  const user = getCurrentUser(req);
  const dashboards = getAvailableDashboards(user.role);
  res.render('dashboards.ejs', { user: { id: user.id, name: user.name, role: user.role }, dashboards, _dashboardsMeta: getAllDashboardsMeta() });
});

app.get('/api/dashboards', requireAuth, (req, res) => {
  const user = getCurrentUser(req);
  res.json(getAvailableDashboards(user.role));
});

// Toggle dashboard status (admin only)
app.post('/api/dashboards/:name/status', requireAdmin, (req, res) => {
  const { name } = req.params;
  const { status } = req.body;
  if (!status || !['ready', 'draft'].includes(status)) {
    return res.status(400).json({ error: 'Status must be "ready" or "draft"' });
  }
  const meta = readDashboardsMeta();
  if (!meta[name]) {
    return res.status(404).json({ error: 'Dashboard not found' });
  }
  meta[name].status = status;
  writeDashboardsMeta(meta);
  console.log(`🔁 Dashboard "${name}" status → ${status}`);
  res.json({ ok: true, name, status });
});

// --------------- Dialogs API ---------------
app.get('/api/dialogs', requireAdmin, (req, res) => {
  res.json(getUserDialogs(req.session.userId));
});

app.post('/api/dialogs', requireAdmin, (req, res) => {
  const dialog = createDialog(req.session.userId, req.body.title || 'Новый диалог');
  res.json(dialog);
});

app.delete('/api/dialogs/:id', requireAdmin, (req, res) => {
  deleteDialog(req.session.userId, req.params.id);
  res.json({ ok: true });
});

// --------------- Chat API — через Gateway напрямую ---------------
app.post('/api/chat', requireAdmin, async (req, res) => {
  const { dialogId, message } = req.body;
  if (!dialogId || !message) return res.status(400).json({ error: 'Missing params' });

  const userId = req.session.userId;
  saveMessage(userId, dialogId, 'user', message);

  try {
    const reply = await callGateway(userId, dialogId);
    if (reply) {
      saveMessage(userId, dialogId, 'assistant', reply);
      updateDialogPreview(userId, dialogId, reply);
    }
    res.json({ reply: reply || '⚠️ Пустой ответ' });
  } catch (e) {
    console.error('[chat error] dialog=' + dialogId + ' user=' + userId + ':', e.message);
    const errReply = '⚠️ Клевер временно недоступен. Попробуйте через несколько минут.';
    saveMessage(userId, dialogId, 'assistant', errReply);
    res.json({ reply: errReply });
  }
});

// --------------- Gateway API вызов (напрямую, без spawn) ---------------
function callGateway(userId, dialogId) {
  return new Promise((resolve, reject) => {
    const messages = loadDialogHistory(userId, dialogId);
    if (messages.length === 0) return reject(new Error('Нет сообщений'));

    const body = JSON.stringify({
      model: 'openclaw/default',
      messages: messages
    });

    const options = {
      hostname: GATEWAY_HOST,
      port: GATEWAY_PORT,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': Buffer.from([66,101,97,114,101,114,32]).toString() + GATEWAY_TOKEN,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-openclaw-thinking': 'low'
      },
      timeout: 1800000 // 30 минут — сложные задачи могут быть долгими
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk.toString(); });
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            console.error('[gateway] HTTP ' + res.statusCode + ': ' + data.substring(0, 200));
            return reject(new Error('Gateway ответил ' + res.statusCode));
          }
          const json = JSON.parse(data);
          if (json.choices && json.choices.length > 0) {
            return resolve(json.choices[0].message.content);
          }
          if (json.error) return reject(new Error(json.error.message));
          resolve(null);
        } catch (e) {
          console.error('[gateway] Parse error (status ' + res.statusCode + '):', data.substring(0, 300));
          reject(new Error('Ошибка ответа: ' + e.message));
        }
      });
    });

    req.on('error', (e) => reject(new Error('Сетевая ошибка: ' + e.message)));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Таймаут Gateway (30 мин). Задача слишком сложная, попробуйте разбить на части.'));
    });

    req.write(body);
    req.end();
  });
}

// Serve project static files for dashboards
app.use('/dashboard-files', requireAuth, express.static(PROJECTS_DIR));

// --------------- Views ---------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --------------- Start ---------------
;(async () => {
  await mountDashboards();
  app.listen(PORT, '0.0.0.0', () => {
  console.log('🍀 Клевер на http://0.0.0.0:' + PORT);
  console.log('   Логины: ivan, olga, anastasia');
  console.log('   Пароли: {логин}123');
  console.log('   Gateway: ' + (GATEWAY_TOKEN ? 'connected' : 'NO TOKEN'));
  });
})();

// ============== Helpers ==============

function getCurrentUser(req) {
  return USERS.find(u => u.id === req.session.userId);
}

function getUserDialogs(userId) {
  const metaFile = path.join(DIALOGS_DIR, userId, '_meta.json');
  if (!fs.existsSync(metaFile)) return [];
  try {
    const dialogs = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
    dialogs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return dialogs;
  } catch(e) { return []; }
}

function getDialogMessages(userId, dialogId) {
  const msgFile = path.join(DIALOGS_DIR, userId, dialogId + '.json');
  if (!fs.existsSync(msgFile)) return [];
  try { return JSON.parse(fs.readFileSync(msgFile, 'utf-8')); }
  catch(e) { return []; }
}

function loadDialogHistory(userId, dialogId) {
  const msgs = getDialogMessages(userId, dialogId);
  return msgs.map(function(m) {
    return { role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content };
  });
}

function updateDialogPreview(userId, dialogId, lastMessage) {
  const metaFile = path.join(DIALOGS_DIR, userId, '_meta.json');
  if (!fs.existsSync(metaFile)) return;
  try {
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
    const d = meta.find(m => m.id === dialogId);
    if (d) {
      d.lastMessage = lastMessage.substring(0, 60) + (lastMessage.length > 60 ? '...' : '');
      d.updatedAt = Date.now();
      meta.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));
    }
  } catch(e) {}
}

function createDialog(userId, title) {
  const userDir = path.join(DIALOGS_DIR, userId);
  fs.mkdirSync(userDir, { recursive: true });
  const metaFile = path.join(userDir, '_meta.json');
  let meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf-8')) : [];
  const dialog = {
    id: crypto.randomUUID(), title: title,
    lastMessage: '', createdAt: Date.now(), updatedAt: Date.now()
  };
  meta.unshift(dialog);
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));
  fs.writeFileSync(path.join(userDir, dialog.id + '.json'), '[]\n');
  return dialog;
}

function deleteDialog(userId, dialogId) {
  const metaFile = path.join(DIALOGS_DIR, userId, '_meta.json');
  const msgFile = path.join(DIALOGS_DIR, userId, dialogId + '.json');
  if (fs.existsSync(metaFile)) {
    let meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
    meta = meta.filter(d => d.id !== dialogId);
    fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));
  }
  if (fs.existsSync(msgFile)) fs.unlinkSync(msgFile);
}

function saveMessage(userId, dialogId, role, content) {
  const msgFile = path.join(DIALOGS_DIR, userId, dialogId + '.json');
  const msgs = fs.existsSync(msgFile) ? JSON.parse(fs.readFileSync(msgFile, 'utf-8')) : [];
  msgs.push({
    role: role, content: content,
    time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
    ts: Date.now()
  });
  fs.writeFileSync(msgFile, JSON.stringify(msgs, null, 2));
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

function getAvailableDashboards(userRole) {
  const dashboards = [];
  const isAdmin = userRole === 'admin';
  const knownProjects = {
    'rshu-dashboard': { url: '/rshu-dashboard/' },
    'drop-dashboard': { url: '/drop-dashboard/' },
    'kom-dashboard': { url: '/kom-dashboard/' },
    'test-dashboard': { url: '/test-dashboard/' }
  };

  try {
    const entries = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      if (['web-interface', 'dashboard2'].includes(entry.name)) continue;

      const meta = getDashboardStatus(entry.name);

      // Гости видят только ready, админы — всё
      if (!isAdmin && (!meta || meta.status !== 'ready')) continue;

      if (knownProjects[entry.name]) {
        const kp = knownProjects[entry.name];
        dashboards.push({
          name: entry.name,
          description: meta ? meta.label : entry.name,
          icon: meta ? meta.icon : '📁',
          url: kp.url,
          status: meta ? meta.status : 'draft'
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
          url: '/dashboard-files/' + entry.name + '/',
          status: meta ? meta.status : 'draft'
        });
      }
    }
  } catch (e) { console.error('Error scanning dashboards:', e.message); }
  return dashboards;
}
