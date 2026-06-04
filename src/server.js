// Dashboard + control API.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from './config.js';
import { load, save } from './store.js';
import { runCheck, activeConfig } from './monitor.js';
import { getNotifier } from './notifiers/index.js';
import { locationsWithinRadius } from './locations.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createServer({ scheduleInfo } = {}) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.get('/api/status', (req, res) => {
    const cfg = activeConfig();
    const state = load();
    res.json({
      config: publicCfg(cfg),
      lastRun: state.lastRun,
      schedule: scheduleInfo || cfg.checkIntervalCron,
      locations: locationsWithinRadius(cfg.origin, cfg.radiusMiles),
      results: state.results,
      alerts: state.alerts.slice(0, 20),
    });
  });

  app.get('/api/history', (req, res) => res.json(load().history));

  app.post('/api/check', async (req, res) => {
    try {
      res.json(await runCheck({}));
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  // Update tunable settings (budget, awd, radius, provider, notifier, interval).
  app.post('/api/config', (req, res) => {
    const allowed = ['budgetUSD', 'rentalDays', 'awdCode', 'radiusMiles', 'provider', 'notifier', 'alertCooldownHours'];
    const state = load();
    state.overrides = state.overrides || {};
    for (const k of allowed) if (k in req.body) state.overrides[k] = req.body[k];
    save(state);
    res.json({ ok: true, overrides: state.overrides });
  });

  app.post('/api/test-alert', async (req, res) => {
    const cfg = activeConfig();
    const r = await getNotifier(cfg.notifier).send({
      title: '✅ Avis Watcher test',
      message: `Alerts via "${cfg.notifier}" are working. Budget $${cfg.budgetUSD} / ${cfg.rentalDays} days within ${cfg.radiusMiles} mi of ${cfg.origin.name}.`,
      url: 'https://www.avis.com/',
    });
    res.status(r.ok ? 200 : 400).json(r);
  });

  return app;
}

function publicCfg(cfg) {
  return {
    budgetUSD: cfg.budgetUSD,
    rentalDays: cfg.rentalDays,
    radiusMiles: cfg.radiusMiles,
    origin: cfg.origin,
    awdSet: !!cfg.awdCode,
    provider: cfg.provider,
    notifier: cfg.notifier,
    alertCooldownHours: cfg.alertCooldownHours,
  };
}
