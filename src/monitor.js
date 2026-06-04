// The engine: for each in-radius location × candidate start date, get a quote,
// evaluate against budget, and fire ONE alert per new qualifying deal (deduped
// with a cooldown so you aren't spammed every cycle).
import config from './config.js';
import { locationsWithinRadius } from './locations.js';
import { candidateWindows, fmt } from './dates.js';
import { getProvider } from './providers/index.js';
import { getNotifier } from './notifiers/index.js';
import { load, save, pushHistory } from './store.js';

export function activeConfig() {
  const state = load();
  return { ...config, ...state.overrides };
}

export async function runCheck({ now = new Date() } = {}) {
  const cfg = activeConfig();
  const provider = getProvider(cfg.provider);
  const locations = locationsWithinRadius(cfg.origin, cfg.radiusMiles);
  const windows = candidateWindows(cfg.startDateStrategy, cfg.rentalDays, now);
  const nowIso = now.toISOString();

  // For the live scraper, trickle requests with a randomized gap between
  // locations so a run looks like casual browsing, not a burst of bot traffic.
  const gap = cfg.provider === 'avis' ? cfg.playwright?.jitterBetweenLocationsMs || [4000, 12000] : null;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const results = [];
  for (const [idx, location] of locations.entries()) {
    if (gap && idx > 0) await sleep(gap[0] + Math.random() * (gap[1] - gap[0]));
    let best = null;
    let lastFail = null;
    for (const w of windows) {
      let q;
      try {
        q = await provider.getQuote({
          location,
          pickup: w.pickup,
          ret: w.ret,
          awdCode: cfg.awdCode,
          rentalDays: cfg.rentalDays,
        });
      } catch (e) {
        q = { ok: false, error: String(e.message || e) };
      }
      if (q.ok && (!best || q.priceUSD < best.priceUSD)) {
        best = { ...q, window: w.label, pickup: fmt(w.pickup), ret: fmt(w.ret) };
      } else if (!q.ok) {
        lastFail = q; // remember blocked/error so it surfaces in the result
      }
    }
    results.push({
      code: location.code,
      name: location.name,
      distance: location.distance,
      checkedAt: nowIso,
      ...(best || lastFail || { ok: false, error: 'no quote' }),
      qualifies: !!(best && best.priceUSD <= cfg.budgetUSD),
    });
  }

  // Persist
  const state = load();
  state.lastRun = nowIso;
  state.results = results;
  pushHistory(
    state,
    results.filter((r) => r.ok).map((r) => ({ t: nowIso, code: r.code, price: r.priceUSD, pickup: r.pickup }))
  );

  // Alert on qualifying deals, deduped by location+pickup within cooldown.
  const qualifying = results.filter((r) => r.qualifies).sort((a, b) => a.priceUSD - b.priceUSD);
  const notifier = getNotifier(cfg.notifier);
  const cooldownMs = (cfg.alertCooldownHours || 24) * 3600 * 1000;
  const fresh = qualifying.filter((r) => {
    const key = `${r.code}:${r.pickup}`;
    const prev = state.alerts.find((a) => a.key === key);
    return !prev || now.getTime() - new Date(prev.t).getTime() > cooldownMs || r.priceUSD < prev.price - 1;
  });

  for (const r of fresh) {
    const base = r.baseUSD ? ` (base $${r.baseUSD} pre-tax)` : '';
    const aarp = cfg.awdCode && !(r.warnings || []).includes('awd-not-applied') ? ' · AARP applied' : '';
    const title = `🚗 Avis ${r.code} $${r.priceUSD} all-in for ${cfg.rentalDays} days`;
    const message =
      `${r.name} (${r.distance} mi from ${cfg.origin.name})\n` +
      `$${r.priceUSD} all-in incl. taxes & fees${base} — under your $${cfg.budgetUSD} budget${aarp}\n` +
      `Pickup ${r.pickup} → return ${r.ret}\n` +
      `${r.carClass}`;
    const res = await notifier.send({ title, message, url: r.url });
    state.alerts.unshift({ key: `${r.code}:${r.pickup}`, t: nowIso, price: r.priceUSD, sent: res.ok, error: res.error });
    if (!res.ok) console.error(`notify failed (${cfg.notifier}): ${res.error}`);
  }
  state.alerts = state.alerts.slice(0, 200);
  save(state);

  const okCount = results.filter((r) => r.ok).length;
  const blocked = results.filter((r) => r.blocked).length;
  return { lastRun: nowIso, checked: results.length, ok: okCount, blocked, qualifying: qualifying.length, alerted: fresh.length, results };
}
