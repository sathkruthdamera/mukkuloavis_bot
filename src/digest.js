// Daily "lowest prices found today" digest to Telegram — gives you market
// visibility even when nothing dipped under budget.
import { load } from './store.js';
import { getNotifier } from './notifiers/index.js';
import { activeConfig } from './monitor.js';

export async function sendDigest() {
  const cfg = activeConfig();
  const state = load();
  const low = state.dailyLows;
  const notifier = getNotifier(cfg.notifier);

  if (!low || !Object.keys(low.byCode || {}).length) {
    const res = await notifier.send({
      title: '📊 Avis daily digest',
      message: 'No prices were captured today (runs blocked, or the agent did not run). Start Brave + the agent to collect prices.',
    });
    return { sent: res.ok, count: 0, error: res.error };
  }

  const rows = Object.entries(low.byCode)
    .map(([code, v]) => ({ code, ...v }))
    .sort((a, b) => a.priceUSD - b.priceUSD);
  const top = rows.slice(0, 12);
  const best = rows[0];
  const underBudget = rows.filter((r) => r.priceUSD <= cfg.budgetUSD).length;

  const lines = top.map((r, i) => {
    const where = r.resolvedLocation || r.name;
    const fees = r.taxesFeesUSD != null ? ` (incl. $${r.taxesFeesUSD} tax+fees)` : '';
    return `${i + 1}. $${r.priceUSD} all-in${fees} — ${where} (${r.distance}mi) · ${r.pickup}`;
  });
  const bestWhere = best.resolvedLocation || best.name;
  const message =
    `Lowest monthly all-in prices seen today (${low.date}), ${rows.length} locations priced:\n\n` +
    lines.join('\n') +
    `\n\nCheapest: $${best.priceUSD} all-in — ${bestWhere}` +
    (best.baseUSD != null && best.taxesFeesUSD != null ? `\nBase $${best.baseUSD} + taxes & fees $${best.taxesFeesUSD}` : '') +
    (best.carClass ? `\n${best.carClass}` : '') +
    (underBudget
      ? `\n✅ ${underBudget} under your $${cfg.budgetUSD} budget`
      : `\nNone under your $${cfg.budgetUSD} budget today.`);

  const res = await notifier.send({ title: '📊 Avis daily digest', message, url: best.url });
  return { sent: res.ok, count: rows.length, cheapest: best.priceUSD, error: res.error };
}
