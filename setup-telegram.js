// One-shot Telegram setup:
//   node setup-telegram.js <BOT_TOKEN>
// - validates the token (getMe)
// - auto-detects your chat id from the message you sent the bot (getUpdates)
// - writes/merges .env (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, NOTIFIER=telegram)
// - sends a confirmation message
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV = path.join(__dirname, '.env');

const token = (process.argv[2] || process.env.TELEGRAM_BOT_TOKEN || '').trim();
if (!token) {
  console.error('Usage: node setup-telegram.js <BOT_TOKEN>');
  process.exit(1);
}

const api = (m) => `https://api.telegram.org/bot${token}/${m}`;

function mergeEnv(updates) {
  let lines = fs.existsSync(ENV) ? fs.readFileSync(ENV, 'utf8').split('\n') : [];
  if (!lines.length && fs.existsSync(path.join(__dirname, '.env.example'))) {
    lines = fs.readFileSync(path.join(__dirname, '.env.example'), 'utf8').split('\n');
  }
  for (const [k, v] of Object.entries(updates)) {
    const i = lines.findIndex((l) => l.match(new RegExp(`^\\s*${k}\\s*=`)));
    if (i >= 0) lines[i] = `${k}=${v}`;
    else lines.push(`${k}=${v}`);
  }
  fs.writeFileSync(ENV, lines.join('\n'));
}

async function main() {
  // 1. validate token
  const me = await (await fetch(api('getMe'))).json();
  if (!me.ok) {
    console.error('❌ Invalid bot token. Re-copy it from @BotFather.');
    process.exit(1);
  }
  console.log(`✓ Bot connected: @${me.result.username}`);

  // 2. find chat id from the most recent message sent TO the bot
  const upd = await (await fetch(api('getUpdates'))).json();
  const msgs = (upd.result || [])
    .map((u) => u.message || u.edited_message || (u.my_chat_member && { chat: u.my_chat_member.chat }))
    .filter(Boolean);
  const chat = msgs.length ? msgs[msgs.length - 1].chat : null;

  if (!chat) {
    console.log('\n⚠️  No message found yet.');
    console.log(`   1) Open Telegram and message your bot: https://t.me/${me.result.username}`);
    console.log('   2) Send it anything (e.g. "hi").');
    console.log(`   3) Re-run:  node setup-telegram.js ${token}\n`);
    // still save the token so the next run is shorter
    mergeEnv({ TELEGRAM_BOT_TOKEN: token, NOTIFIER: 'telegram' });
    process.exit(2);
  }

  const chatId = chat.id;
  console.log(`✓ Found chat id: ${chatId} (${chat.first_name || chat.title || 'you'})`);

  // 3. write .env
  mergeEnv({ TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: String(chatId), NOTIFIER: 'telegram' });
  console.log('✓ Wrote .env (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, NOTIFIER=telegram)');

  // 4. send confirmation
  const send = await (
    await fetch(api('sendMessage'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: '✅ Avis Watcher is connected. You\'ll get a message here when a 30-day rental near Dallas drops under $900 with your AARP rate.',
      }),
    })
  ).json();

  if (send.ok) console.log('\n🎉 Test message sent — check Telegram. Setup complete.');
  else console.error('\n⚠️  Saved config but test send failed:', send.description);
}

main().catch((e) => {
  console.error('Error:', e.message || e);
  process.exit(1);
});
