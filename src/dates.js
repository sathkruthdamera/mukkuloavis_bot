// Builds the candidate pickup windows to price each run. We check several
// start dates because Avis pricing "varies every week" — a 30-day rental
// starting next Tuesday can be far cheaper than one starting this Friday.
export function candidateWindows(strategy, rentalDays, now = new Date()) {
  const { leadDaysMin = 3, candidates = 4, stepDays = 7 } = strategy || {};
  const out = [];
  for (let i = 0; i < candidates; i++) {
    const pickup = new Date(now);
    pickup.setHours(10, 0, 0, 0);
    pickup.setDate(pickup.getDate() + leadDaysMin + i * stepDays);
    const ret = new Date(pickup);
    ret.setDate(ret.getDate() + rentalDays);
    out.push({ pickup, ret, label: `${fmt(pickup)} → ${fmt(ret)}` });
  }
  return out;
}

export function fmt(d) {
  return d.toISOString().slice(0, 10);
}
