import config from '../config.js';

// Each notifier: async send({ title, message, url }) -> { ok, error? }

const console_ = {
  async send({ title, message }) {
    console.log(`\n🔔 [ALERT] ${title}\n${message}\n`);
    return { ok: true };
  },
};

const telegram = {
  async send({ title, message, url }) {
    const { token, chatId } = config.secrets.telegram;
    if (!token || !chatId) return { ok: false, error: 'TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set' };
    // HTML mode is forgiving (only &<> need escaping); Telegram auto-links URLs.
    const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const text = `<b>${esc(title)}</b>\n${esc(message)}${url ? `\n${esc(url)}` : ''}`;
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: false }),
    });
    if (!res.ok) return { ok: false, error: `telegram ${res.status}: ${await res.text().catch(() => '')}` };
    return { ok: true };
  },
};

const pushover = {
  async send({ title, message, url }) {
    const { user, token } = config.secrets.pushover;
    if (!user || !token) return { ok: false, error: 'PUSHOVER_USER / PUSHOVER_TOKEN not set' };
    const body = new URLSearchParams({ token, user, title, message });
    if (url) body.set('url', url);
    const res = await fetch('https://api.pushover.net/1/messages.json', { method: 'POST', body });
    if (!res.ok) return { ok: false, error: `pushover ${res.status}` };
    return { ok: true };
  },
};

// iMessage: if we're ON a Mac, send via osascript; otherwise POST to the relay
// you run on your always-on Mac (see README).
const imessage = {
  async send({ title, message, url }) {
    const { to, relayUrl, relaySecret } = config.secrets.imessage;
    if (!to) return { ok: false, error: 'IMESSAGE_TO not set' };
    const text = `${title}\n${message}${url ? `\n${url}` : ''}`;
    if (!relayUrl && process.platform === 'darwin') {
      const { execFile } = await import('node:child_process');
      const script = `tell application "Messages" to send ${JSON.stringify(text)} to buddy ${JSON.stringify(to)} of (1st service whose service type = iMessage)`;
      return new Promise((resolve) =>
        execFile('osascript', ['-e', script], (err) => resolve(err ? { ok: false, error: String(err) } : { ok: true }))
      );
    }
    if (!relayUrl) return { ok: false, error: 'IMESSAGE_RELAY_URL not set (needed off a Mac)' };
    const res = await fetch(relayUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-secret': relaySecret || '' },
      body: JSON.stringify({ to, text }),
    });
    if (!res.ok) return { ok: false, error: `relay ${res.status}` };
    return { ok: true };
  },
};

const NOTIFIERS = { console: console_, telegram, pushover, imessage };

export function getNotifier(name) {
  return NOTIFIERS[name] || console_;
}
