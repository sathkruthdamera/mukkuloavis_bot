// Dependency-free hourly nudge. Sends a Telegram message with the AARP code, a
// rolling 30-day window, and in-range pickup locations so you can check Avis in
// ~10 seconds. (Avis/PerimeterX blocks automated price reads, so a human tap is
// the reliable free path — this just hands you everything pre-figured.)
const token = process.env.TELEGRAM_BOT_TOKEN;
const chat = process.env.TELEGRAM_CHAT_ID;
const awd = process.env.AWD_CODE || 'A359824';
const budget = process.env.BUDGET_USD || '900';

if (!token || !chat) {
  console.error('Missing TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID');
  process.exit(1);
}

const fmt = (d) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const now = new Date();
const p1 = new Date(now); p1.setDate(p1.getDate() + 3);
const r1 = new Date(p1); r1.setDate(r1.getDate() + 30);
const p2 = new Date(now); p2.setDate(p2.getDate() + 10);
const r2 = new Date(p2); r2.setDate(r2.getDate() + 30);

const locations = [
  'DFW Airport',
  'Dallas Love Field (DAL)',
  'Fort Worth, TX',
  'Arlington, TX',
  'Plano, TX',
];
const aarpLink = 'https://www.avis.com/en/offers/partners/aarp-members-save-30';

const msg =
  `🚗 <b>Avis monthly-rental check</b>\n` +
  `Target: <b>under $${budget}</b> for 30 days · AARP AWD <code>${awd}</code>\n\n` +
  `<b>Try these 30-day windows:</b>\n` +
  `• ${fmt(p1)} → ${fmt(r1)}\n` +
  `• ${fmt(p2)} → ${fmt(r2)}\n\n` +
  `<b>Pickup spots ≤150 mi of Dallas:</b>\n• ${locations.join('\n• ')}\n\n` +
  `👉 <a href="${aarpLink}">Book with AARP rate</a> — enter a location + one window above, AWD <code>${awd}</code>, and grab it if it's under $${budget}.`;

const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ chat_id: chat, text: msg, parse_mode: 'HTML', disable_web_page_preview: true }),
});
const j = await res.json();
if (!j.ok) {
  console.error('Telegram error:', JSON.stringify(j));
  process.exit(1);
}
console.log('Sent ✓');
