const fs = require('fs');
const path = require('path');
const inboxDir = '/root/.openclaw/workspace/inbox';

function check() {
  const files = fs.readdirSync(inboxDir).filter(f => f.endsWith('.json') && f !== '_inbox.jsonl');
  const pending = [];
  for (const f of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(inboxDir, f), 'utf-8'));
      if (!data.processed) pending.push(data);
    } catch(e) {}
  }
  if (pending.length > 0) {
    for (const p of pending) {
      console.log(`\n📬 [${p.user || p.userId}] ${p.message.substring(0, 200)}`);
      // Помечаем как обработанное (чтобы повторно не показывать)
      p.processed = true;
      // Но не удаляем — ответ ещё не написан
    }
  }
}
check();
