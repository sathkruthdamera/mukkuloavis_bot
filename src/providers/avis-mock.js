// Deterministic fake pricing so the full pipeline (schedule → evaluate →
// notify → dashboard) works before you tune the real scraper. Prices "vary
// every week" by seeding off location + pickup date, and dip below budget
// often enough that you can see/test alerts.
import { fmt } from '../dates.js';

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295; // 0..1
}

export const name = 'mock';

// A city search (e.g. "Muskogee, OK") resolves to several real Avis branches.
// Mock a deterministic specific branch so the alert can name exactly one.
const BRANCHES = ['Downtown', 'Airport', 'North', 'East Side', 'Auto Mall', 'Hwy 69'];

export async function getQuote({ location, pickup, ret, awdCode, rentalDays }) {
  const week = Math.floor(pickup.getTime() / (7 * 864e5));
  const base = 700 + hash(location.code + ':base') * 700; // 700..1400 base (pre-tax) per location
  const wiggle = (hash(`${location.code}:${week}`) - 0.5) * 500; // weekly swing ±250
  const awdCut = awdCode ? base * 0.12 : 0; // AARP shaves ~12% off the base rate
  const baseAfterAwd = Math.round(base + wiggle - awdCut);
  const taxesFees = Math.round(baseAfterAwd * 0.18); // ~18% taxes + fees on top
  const allIn = baseAfterAwd + taxesFees;

  // Pick one specific branch deterministically so we report the exact location.
  const branch = BRANCHES[Math.floor(hash(location.code + ':branch') * BRANCHES.length)];
  const resolvedLocation = `Avis ${location.name} – ${branch}`;

  return {
    ok: true,
    priceUSD: allIn, // all-in (base − AWD + taxes + fees) — the budget figure
    allInUSD: allIn,
    baseUSD: baseAfterAwd,
    taxesFeesUSD: taxesFees,
    awdSavingsUSD: Math.round(awdCut),
    resolvedLocation,
    branchCount: BRANCHES.length,
    carClass: 'Intermediate',
    currency: 'USD',
    url: `https://www.avis.com/`,
    warnings: awdCode ? [] : ['awd-not-applied'],
    detail: `${resolvedLocation} · ${fmt(pickup)}..${fmt(ret)} · ${rentalDays}d${awdCode ? ' · AARP' : ''}`,
  };
}
