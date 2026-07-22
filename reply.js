const fs = require('fs');
const path = require('path');

const dialogId = process.argv[2];
const replyText = process.argv[3];

if (!dialogId || !replyText) {
  console.error('Usage: node reply.js <dialogId> "<reply text>"');
  process.exit(1);
}

const outboxDir = '/root/.openclaw/workspace/outbox';
fs.mkdirSync(outboxDir, { recursive: true });

const outboxFile = path.join(outboxDir, dialogId + '.json');
fs.writeFileSync(outboxFile, JSON.stringify({
  dialogId,
  reply: replyText,
  ts: Date.now()
}, null, 2));

// Помечаем inbox как обработанный
const inboxDir = '/root/.openclaw/workspace/inbox';
const inboxFile = path.join(inboxDir, dialogId + '.json');
if (fs.existsSync(inboxFile)) {
  try {
    const data = JSON.parse(fs.readFileSync(inboxFile, 'utf-8'));
    data.processed = true;
    fs.writeFileSync(inboxFile, JSON.stringify(data, null, 2));
  } catch(e) {}
}

console.log('✅ Ответ записан в outbox для диалога ' + dialogId);
