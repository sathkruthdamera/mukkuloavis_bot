// Entry point: starts the dashboard, schedules recurring checks, and (unless
// --once) keeps running 24/7. `npm run check` runs a single cycle and exits.
import cron from 'node-cron';
import config from './config.js';
import { createServer } from './server.js';
import { runCheck, activeConfig } from './monitor.js';
import { getNotifier } from './notifiers/index.js';

const ONCE = process.argv.includes('--once');
const REPORT = process.argv.includes('--report'); // also Telegram a run summary

async function main() {
  const cfg = activeConfig();
  console.log(`Avis Watcher — provider=${cfg.provider} notifier=${cfg.notifier}`);
  console.log(`Budget $${cfg.budgetUSD} for ${cfg.rentalDays} days within ${cfg.radiusMiles} mi of ${cfg.origin.name}`);
  if (!cfg.awdCode) console.warn('⚠️  No AWD code set — AARP discount will NOT be applied. Set AWD_CODE in .env.');

  if (ONCE) {
    const r = await runCheck({});
    console.log(summarize(r));
    if (REPORT) await sendReport(cfg, r);
    process.exit(0);
  }

  const app = createServer({ scheduleInfo: cfg.checkIntervalCron });
  app.listen(cfg.webPort, () => console.log(`Dashboard → http://localhost:${cfg.webPort}`));

  // Initial run, then on schedule.
  runCheck({}).then((r) => console.log(summarize(r))).catch((e) => console.error(e));
  cron.schedule(cfg.checkIntervalCron, () => {
    runCheck({})
      .then((r) => console.log(`[${new Date().toISOString()}] ${summarize(r)}`))
      .catch((e) => console.error('check failed:', e));
  });
}

function summarize(r) {
  return `[${r.tier}] checked ${r.checked} locations · ${r.ok} priced · ${r.blocked} blocked · ${r.qualifying} under budget · ${r.alerted} new alert(s)`;
}

// One-off status to Telegram so you can confirm the outcome from your phone.
async function sendReport(cfg, r) {
  const best = r.results.filter((x) => x.ok).sort((a, b) => a.priceUSD - b.priceUSD)[0];
  const verdict = r.blocked === r.checked
    ? 'ALL locations were BLOCKED by Avis bot-detection (PerimeterX). A datacenter IP cannot read prices — this confirms the wall.'
    : r.ok > 0
      ? `Got real prices from ${r.ok}/${r.checked} locations. Best: $${best.priceUSD} at ${best.name}.`
      : `No prices and not clearly blocked — ${r.checked} checked, see logs.`;
  const msg =
    `Checked ${r.checked} · priced ${r.ok} · blocked ${r.blocked} · under $${cfg.budgetUSD}: ${r.qualifying}\n\n${verdict}`;
  const res = await getNotifier(cfg.notifier).send({ title: '🧪 Avis scrape test', message: msg });
  console.log(res.ok ? 'report sent ✓' : `report failed: ${res.error}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
