// Dependency-free hourly nudge. Sends a Telegram message with the AARP code, the
// 8th–11th → same-day-next-month windows, and in-range pickup locations so you
// can check Avis in ~10 seconds. (Avis/PerimeterX blocks automated price reads,
// so a human tap is the reliable free path — this just hands you everything
// pre-figured. Remember to read the FULL all-in price after taxes & fees.)
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

// Calendar-month windows: pick up on the 8/9/10/11, return the SAME day next
// month. Use the nearest upcoming set that's ≥3 days out (rolls to next month
// automatically once those days pass).
const LEAD_DAYS = 3;
const earliest = new Date(now); earliest.setHours(10, 0, 0, 0); earliest.setDate(earliest.getDate() + LEAD_DAYS);
const windowFor = (day) => {
  let p = new Date(earliest.getFullYear(), earliest.getMonth(), day, 10, 0, 0, 0);
  while (p < earliest) p = new Date(p.getFullYear(), p.getMonth() + 1, day, 10, 0, 0, 0);
  const r = new Date(p.getFullYear(), p.getMonth() + 1, p.getDate(), 10, 0, 0, 0);
  return { p, r };
};
const windows = [8, 9, 10, 11].map(windowFor);

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
  `Target: <b>under $${budget}</b> all-in (after taxes & fees) · AARP AWD <code>${awd}</code>\n\n` +
  `<b>Try these monthly windows (8th–11th → same day next month):</b>\n` +
  windows.map((w) => `• ${fmt(w.p)} → ${fmt(w.r)}`).join('\n') + `\n\n` +
  `<b>Pickup spots ≤150 mi of Dallas:</b>\n• ${locations.join('\n• ')}\n\n` +
  `👉 <a href="${aarpLink}">Book with AARP rate</a> — enter a location + one window above, apply AWD <code>${awd}</code>, and grab it if the <b>full all-in price (after taxes & fees)</b> is under $${budget}.`;

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
