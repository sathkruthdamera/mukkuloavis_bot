// Loads config.json, layers .env secrets/overrides on top, and exposes one object.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// --- minimal .env loader (no dependency) ---
function loadEnv() {
  const p = path.join(ROOT, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const val = m[2].replace(/^["']|["']$/g, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}
loadEnv();

const file = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));

export const config = {
  ...file,
  awdCode: process.env.AWD_CODE || file.awdCode || '',
  provider: process.env.PROVIDER || file.provider,
  notifier: process.env.NOTIFIER || file.notifier,
  webPort: Number(process.env.WEB_PORT || file.webPort || 4100),
  secrets: {
    pushover: { user: process.env.PUSHOVER_USER, token: process.env.PUSHOVER_TOKEN },
    imessage: {
      to: process.env.IMESSAGE_TO,
      relayUrl: process.env.IMESSAGE_RELAY_URL,
      relaySecret: process.env.IMESSAGE_RELAY_SECRET,
    },
    telegram: { token: process.env.TELEGRAM_BOT_TOKEN, chatId: process.env.TELEGRAM_CHAT_ID },
  },
  paths: { root: ROOT, data: path.join(ROOT, 'data'), debug: path.join(ROOT, 'debug') },
};

export default config;
