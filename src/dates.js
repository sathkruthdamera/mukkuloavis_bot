// Builds the candidate pickup windows to price each run. We rent for a full
// CALENDAR MONTH: pick up on the 8th, 9th, 10th, or 11th and return the SAME
// day the next month (8th→8th, 9th→9th, …). Each run prices the nearest
// upcoming set of those windows that is at least `leadDaysMin` days out — so a
// run on, say, the 20th rolls the whole set to next month automatically.
export function candidateWindows(strategy, rentalDays, now = new Date()) {
  const { leadDaysMin = 3, pickupDays = [8, 9, 10, 11] } = strategy || {};
  const out = [];
  for (const day of pickupDays) {
    const pickup = nextDayOfMonth(now, day, leadDaysMin);
    const ret = addOneMonth(pickup);
    const days = Math.round((ret - pickup) / 864e5);
    out.push({ pickup, ret, days, label: `${fmt(pickup)} → ${fmt(ret)}` });
  }
  return out;
}

// The next date whose day-of-month is `day` and is ≥ `leadDays` out from now,
// pinned to a 10:00 pickup. Rolls forward month-by-month until it clears the
// earliest allowed date.
function nextDayOfMonth(now, day, leadDays) {
  const earliest = new Date(now);
  earliest.setHours(10, 0, 0, 0);
  earliest.setDate(earliest.getDate() + leadDays);
  let d = new Date(earliest.getFullYear(), earliest.getMonth(), day, 10, 0, 0, 0);
  while (d < earliest) d = new Date(d.getFullYear(), d.getMonth() + 1, day, 10, 0, 0, 0);
  return d;
}

// Same day-of-month, one month later — the calendar-month return date.
function addOneMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, d.getDate(), 10, 0, 0, 0);
}

export function fmt(d) {
  return d.toISOString().slice(0, 10);
}
