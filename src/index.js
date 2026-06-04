// Entry point: starts the dashboard, schedules recurring checks, and (unless
// --once) keeps running 24/7. `npm run check` runs a single cycle and exits.
import cron from 'node-cron';
import config from './config.js';
import { createServer } from './server.js';
import { runCheck, activeConfig } from './monitor.js';

const ONCE = process.argv.includes('--once');

async function main() {
  const cfg = activeConfig();
  console.log(`Avis Watcher — provider=${cfg.provider} notifier=${cfg.notifier}`);
  console.log(`Budget $${cfg.budgetUSD} for ${cfg.rentalDays} days within ${cfg.radiusMiles} mi of ${cfg.origin.name}`);
  if (!cfg.awdCode) console.warn('⚠️  No AWD code set — AARP discount will NOT be applied. Set AWD_CODE in .env.');

  if (ONCE) {
    const r = await runCheck({});
    console.log(summarize(r));
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
  return `checked ${r.checked} locations · ${r.qualifying} under budget · ${r.alerted} new alert(s)`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
