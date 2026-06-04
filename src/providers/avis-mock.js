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

export async function getQuote({ location, pickup, ret, awdCode, rentalDays }) {
  const week = Math.floor(pickup.getTime() / (7 * 864e5));
  const base = 700 + hash(location.code + ':base') * 700; // 700..1400 baseline per location
  const wiggle = (hash(`${location.code}:${week}`) - 0.5) * 500; // weekly swing ±250
  const awdCut = awdCode ? base * 0.12 : 0; // pretend AARP shaves ~12%
  const price = Math.round(base + wiggle - awdCut);
  return {
    ok: true,
    priceUSD: price,
    carClass: 'Intermediate',
    currency: 'USD',
    url: `https://www.avis.com/`,
    detail: `${location.name} · ${fmt(pickup)}..${fmt(ret)} · ${rentalDays}d${awdCode ? ' · AARP' : ''}`,
  };
}
