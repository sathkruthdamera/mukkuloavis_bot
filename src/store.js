// Tiny JSON-file persistence for run results, price history, and sent alerts.
import fs from 'node:fs';
import path from 'node:path';
import config from './config.js';

const FILE = path.join(config.paths.data, 'state.json');

const empty = { lastRun: null, results: [], history: [], alerts: [], overrides: {} };

export function load() {
  try {
    return { ...empty, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
  } catch {
    return { ...empty };
  }
}

export function save(state) {
  fs.mkdirSync(config.paths.data, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
}

// History is capped so the file never grows unbounded.
export function pushHistory(state, points) {
  state.history.push(...points);
  if (state.history.length > 5000) state.history = state.history.slice(-5000);
}
