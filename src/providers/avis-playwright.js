// Real Avis scraper. Drives avis.com's booking widget with the live selectors
// confirmed from a DOM probe (June 2026):
//   pickup     [data-testid="pick-up-location-field-input"]  (MUI autocomplete)
//   option     li[data-testid^="pickup-location-option-"]
//   datepicker [data-testid="booking-widget-datepicker-input"] (react-day-picker)
//   day cell   button.rdp-day_button[aria-label*="June 9th, 2026"]
//   month next .rdp-button_next
//   AWD popup  [data-testid="discount-coupon-popup-trigger-button"]
//   search     [data-testid="booking-widget-search-button"]
// Run `npm run scrape:debug` after any Avis redesign; failures dump to ./debug.
import fs from 'node:fs';
import path from 'node:path';
import config from '../config.js';
import { fmt } from '../dates.js';
import { contextOptions, launchArgs, applyStealth, proxyOption, jitter, humanType, humanWander } from '../stealth.js';

export const name = 'avis';

let _pw = null;
async function pw() {
  if (_pw) return _pw;
  try {
    _pw = await import('playwright');
    return _pw;
  } catch {
    throw new Error('playwright not installed. Run: npm i playwright && npx playwright install chromium');
  }
}

const HOME = 'https://www.avis.com/en/home';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
// substring of react-day-picker's aria-label, unique per calendar date
function dayLabel(d) {
  return `${MONTHS[d.getMonth()]} ${ordinal(d.getDate())}, ${d.getFullYear()}`;
}

async function dumpDebug(page, tag) {
  try {
    fs.mkdirSync(config.paths.debug, { recursive: true });
    const stamp = tag.replace(/[^a-z0-9]+/gi, '_');
    await page.screenshot({ path: path.join(config.paths.debug, `${stamp}.png`), fullPage: true });
    fs.writeFileSync(path.join(config.paths.debug, `${stamp}.html`), await page.content());
  } catch {}
}

async function closePopups(page) {
  for (const sel of ['a[data-click="close"]', '.bx-close-inside', '[data-testid="profile-menu-tooltip-close-btn"]']) {
    const el = page.locator(sel).first();
    if (await el.count().catch(() => 0)) await el.click({ timeout: 2000 }).catch(() => {});
  }
  // The BounceX/Wunderkind email overlay reappears on a timer and intercepts
  // clicks — remove the overlay nodes outright so they can't cover the form.
  await page
    .evaluate(() => {
      // [class~="bxc"] matches the BounceX container as a whole class token —
      // narrower than [class*="bxc"], so it can't accidentally remove the widget.
      document
        .querySelectorAll('[id^="bx-campaign"], [class*="bx-overlay"], [class~="bxc"], [class*="bx-base"]')
        .forEach((n) => n.remove());
    })
    .catch(() => {});
}

async function clickDay(page, date) {
  const want = dayLabel(date);
  for (let i = 0; i < 14; i++) {
    // There can be duplicate (hero + sticky) calendars in the DOM — iterate all
    // matches and click the first VISIBLE, enabled one (not just .first()).
    const els = page.locator(`button.rdp-day_button[aria-label*="${want}"]`);
    const n = await els.count().catch(() => 0);
    for (let j = 0; j < n; j++) {
      const el = els.nth(j);
      if ((await el.isVisible().catch(() => false)) && !(await el.isDisabled().catch(() => true))) {
        await el.click();
        return true;
      }
    }
    const next = page.locator('.rdp-button_next:visible').first();
    if (await next.count().catch(() => 0)) {
      await next.click().catch(() => {});
      await page.waitForTimeout(450);
    } else break;
  }
  return false;
}

async function applyAwd(page, awd) {
  const trig = page.locator('[data-testid="discount-coupon-popup-trigger-button"]').first();
  if (!(await trig.count().catch(() => 0))) return false;
  await trig.click().catch(() => {});
  await page.waitForTimeout(1200);
  const cands = [
    'input[name*="awd" i]',
    'input[aria-label*="AWD" i]',
    'input[placeholder*="AWD" i]',
    'input[aria-label*="discount" i]',
    'input[placeholder*="code" i]',
    '[role="dialog"] input[type="text"]',
    '.MuiPopover-root input[type="text"]',
    '.MuiPaper-root input[type="text"]',
  ];
  for (const sel of cands) {
    const el = page.locator(sel).first();
    if ((await el.count().catch(() => 0)) && (await el.isVisible().catch(() => false))) {
      await el.fill(awd).catch(() => {});
      const apply = page.locator('button:has-text("Apply"), [data-testid*="apply" i]').first();
      if (await apply.count().catch(() => 0)) await apply.click().catch(() => {});
      else await el.press('Enter').catch(() => {});
      await page.waitForTimeout(600);
      return true;
    }
  }
  return false;
}

async function readPrices(page) {
  // Prefer an explicit total testid if present; else scan visible "$" amounts
  // with a 30-day-total sanity bound so we don't grab a per-day rate.
  const out = [];
  const testidSel = '[data-testid*="total" i], [data-testid*="price" i], [data-testid*="rate" i]';
  for (const sel of [testidSel, 'text=/\\$\\s?[0-9][0-9,]{2,}(\\.[0-9]{2})?/']) {
    const els = page.locator(sel);
    const n = await els.count().catch(() => 0);
    for (let i = 0; i < Math.min(n, 80); i++) {
      const t = (await els.nth(i).innerText().catch(() => '')) || '';
      for (const m of t.matchAll(/\$\s?([\d,]+(?:\.\d{2})?)/g)) {
        const v = Number(m[1].replace(/,/g, ''));
        if (v >= 200 && v <= 20000) out.push(v); // a 30-day total, not a daily rate
      }
    }
    if (out.length) break;
  }
  return out;
}

// Parse the vehicles API JSON: vehicles[].price[] holds the rate options.
// grossSubtotal = base 30-day price, totalDiscounted = all-in (taxes/fees).
// Returns the single cheapest vehicle/option, with name + all-in for the alert.
const num = (x) => {
  const n = parseFloat(x);
  return Number.isFinite(n) ? n : null;
};
function parseVehicles(text) {
  let data;
  try { data = JSON.parse(text); } catch { return null; }
  const vehicles = data.vehicles || [];
  let best = null;
  for (const v of vehicles) {
    for (const p of v.price || []) {
      const base = num(p.grossSubtotal) ?? num(p.netSubtotal) ?? num(p.total) ?? num(p.totalDiscounted);
      if (base == null || base < 100 || base > 50000) continue;
      const allIn = num(p.totalDiscounted) ?? num(p.total) ?? base;
      if (!best || base < best.priceUSD) {
        best = {
          priceUSD: Math.round(base),
          allInUSD: Math.round(allIn),
          vehicle: v.description || v.makeName || v.vehicleCode || 'vehicle',
          sipp: v.sippCode || '',
          payType: /PAY_NOW/i.test(p.priceType || '') ? 'pay now' : 'pay later',
        };
      }
    }
  }
  return best;
}

export async function getQuote({ location, pickup, ret, awdCode, rentalDays, debugDump = false }) {
  const { chromium } = await pw();
  fs.mkdirSync(config.paths.data, { recursive: true });
  const statePath = path.join(config.paths.data, 'avis-state.json');

  // CDP-attach mode: connect to a REAL Chrome you launched (best free way past
  // PerimeterX — real fingerprint, your residential IP, your warmed cookies, and
  // no navigator.webdriver flag). Falls back to launching a stealth chromium.
  const cdpUrl = process.env.CHROME_CDP_URL || config.playwright?.cdpUrl;
  let browser, ctx, page;
  const attached = !!cdpUrl;
  let reusedTab = false;
  if (attached) {
    browser = await chromium.connectOverCDP(cdpUrl);
    ctx = browser.contexts()[0] || (await browser.newContext());
    // Reuse the already-open, FOREGROUND, fully-hydrated avis.com tab rather
    // than a new background tab (which Chrome throttles so the widget won't
    // hydrate). This is the key to reliable real-browser automation.
    const existing = ctx.pages().find((p) => /avis\.com/.test(p.url()));
    if (existing) { page = existing; reusedTab = true; } else { page = await ctx.newPage(); }
  } else {
    browser = await chromium.launch({ headless: config.playwright?.headless !== false, args: launchArgs });
    ctx = await browser.newContext({
      ...contextOptions,
      ...proxyOption(),
      ...(fs.existsSync(statePath) ? { storageState: statePath } : {}),
    });
    await applyStealth(ctx);
    page = await ctx.newPage();
  }
  page.setDefaultTimeout(config.playwright?.navTimeoutMs || 45000);
  await page.bringToFront().catch(() => {});
  // Force the tab to render as focused/visible even in the background, so Chrome
  // doesn't throttle it and the React booking widget actually hydrates.
  try {
    const cdpSession = await page.context().newCDPSession(page);
    await cdpSession.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    // Force a DESKTOP-width viewport so Avis renders the desktop booking widget
    // (a narrow real-browser window otherwise serves the mobile layout, whose
    // selectors differ). Independent of the actual window size.
    if (attached) {
      await cdpSession.send('Emulation.setDeviceMetricsOverride', {
        width: 1400, height: 900, deviceScaleFactor: 1, mobile: false,
      });
    }
  } catch {}
  await page.addInitScript(() => {
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });
    Object.defineProperty(document, 'hidden', { get: () => false });
    document.hasFocus = () => true;
  }).catch(() => {});
  const tag = `${location.code}_${fmt(pickup)}`;
  const warnings = [];
  try {
    const DBG = process.argv.includes('--debug');
    const mark = (s) => DBG && console.error(`  · step: ${s}`);
    page.on('close', () => DBG && console.error('  !! page closed event'));
    page.on('crash', () => DBG && console.error('  !! page CRASH event'));
    mark('goto');
    await page.goto(HOME, { waitUntil: 'domcontentloaded' });
    // Wait for the React booking widget to actually hydrate (not just DOM ready).
    await page.locator('[data-testid="pick-up-location-field-input"]').first()
      .waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await closePopups(page);
    await humanWander(page);
    mark('home-ready');

    // 1) pickup location — retry through hydration races (the React widget can
    // remount on first paint). Each try: clear popups, wait for visible, click.
    const loc = page.locator('[data-testid="pick-up-location-field-input"]').first();
    let typed = false;
    for (let attempt = 0; attempt < 4 && !typed; attempt++) {
      try {
        await closePopups(page);
        await loc.waitFor({ state: 'visible', timeout: 15000 });
        await loc.click({ timeout: 8000 });
        await loc.fill('');
        for (const ch of location.query) await loc.type(ch, { delay: 90 });
        typed = true;
      } catch {
        await page.waitForTimeout(2000); // let hydration settle, then retry
      }
    }
    if (!typed) { await dumpDebug(page, `noinput_${tag}`); throw new Error('pickup-input-not-found'); }
    await page.waitForTimeout(400);
    mark('typed-location');
    await page.waitForTimeout(2200);
    const opt = page.locator('li[data-testid^="pickup-location-option-"]').first();
    if (await opt.count().catch(() => 0)) await opt.click();
    else { await dumpDebug(page, `noopt_${tag}`); throw new Error('location-option-not-found'); }
    await page.waitForTimeout(1500);
    mark('picked-location');

    // 2) AARP/AWD discount (best-effort — alert still useful without it, but flag)
    if (awdCode) {
      try {
        const ok = await applyAwd(page, awdCode);
        if (!ok) warnings.push('awd-not-applied');
        await closePopups(page);
      } catch {
        warnings.push('awd-step-error');
      }
    }

    // 3) dates: open the calendar (the trigger is a React handler that wants a
    // native DOM click), retrying until .rdp-root actually appears.
    mark('awd-done -> dates');
    for (let i = 0; i < 4; i++) {
      if (await page.locator('.rdp-root:visible').count().catch(() => 0)) break;
      const dp = page.locator('[data-testid="booking-widget-datepicker-input"]:visible').first();
      if (await dp.count().catch(() => 0)) {
        await dp.evaluate((el) => el.click()).catch(() => {});
        await dp.click({ timeout: 3000 }).catch(() => {});
      }
      await page.waitForTimeout(1300);
    }
    mark('datepicker-open');
    if (!(await clickDay(page, pickup))) { await dumpDebug(page, `nopickday_${tag}`); throw new Error('pickup-day-not-clickable'); }
    await page.waitForTimeout(500);
    mark('pickup-day-clicked');
    if (!(await clickDay(page, ret))) warnings.push('return-day-fallback');
    await page.keyboard.press('Escape').catch(() => {});
    mark('dates-done');

    // 4) search — the button is a React handler that only fires on a native
    // DOM click; it POSTs /web/reservation/vehicles which returns prices as JSON
    // (or a 403 + PerimeterX challenge if we're flagged). Capture that response.
    const submit = page.locator('[data-testid="booking-widget-search-button"]:visible').first();
    if (!(await submit.count().catch(() => 0))) throw new Error('search-button-not-found');
    await submit.scrollIntoViewIfNeeded().catch(() => {});
    await jitter(page, 500, 1200);
    const respP = page
      .waitForResponse((r) => /\/web\/reservation\/vehicles/.test(r.url()), { timeout: 20000 })
      .catch(() => null);
    await submit.evaluate((el) => el.click()).catch(() => {});
    mark('search-clicked');
    const resp = await respP;
    if (!resp) { await dumpDebug(page, `noresp_${tag}`); throw new Error('no-vehicles-response'); }

    const status = resp.status();
    const body = await resp.text().catch(() => '');
    mark(`vehicles-response ${status}`);
    if (debugDump) {
      fs.mkdirSync(config.paths.debug, { recursive: true });
      fs.writeFileSync(path.join(config.paths.debug, `vehicles_${tag}.json`), body);
    }

    // PerimeterX block detection
    if (status === 403 || /"appId"\s*:\s*"PX|captcha\.px-cloud|blockScript/.test(body)) {
      return { ok: false, blocked: true, error: 'blocked-perimeterx-403', warnings, detail: location.name };
    }
    if (status >= 400) {
      await dumpDebug(page, `httperr_${tag}`);
      return { ok: false, error: `vehicles-http-${status}`, warnings, detail: location.name };
    }

    const veh = parseVehicles(body);
    if (!veh) throw new Error('no-prices-in-json');

    // Booking/detail link: prefer the reservation page the SPA navigated to;
    // else fall back to the AARP search entry so the alert is still actionable.
    await page.waitForTimeout(1500);
    let url = page.url();
    if (!/reservation|vehicle|select/i.test(url)) url = 'https://www.avis.com/en/offers/partners/aarp-members-save-30';

    return {
      ok: true,
      priceUSD: veh.priceUSD,
      allInUSD: veh.allInUSD,
      carClass: `${veh.vehicle} (${veh.sipp}, ${veh.payType})`,
      currency: 'USD',
      url,
      warnings,
      detail: `${location.name} · ${fmt(pickup)}..${fmt(ret)} · ${rentalDays}d${awdCode && !warnings.includes('awd-not-applied') ? ' · AARP' : ''}`,
    };
  } catch (err) {
    await dumpDebug(page, `error_${tag}`);
    return { ok: false, error: String(err.message || err), warnings, detail: location.name };
  } finally {
    if (attached) {
      // Disconnect, leaving your Chrome running. Only close the tab if WE made it.
      if (!reusedTab) await page.close().catch(() => {});
      await browser.close().catch(() => {});
    } else {
      await ctx.storageState({ path: statePath }).catch(() => {});
      await ctx.close().catch(() => {});
      await browser.close().catch(() => {});
    }
  }
}

// Standalone debug: `npm run scrape:debug`  (dumps the results page for tuning)
if (process.argv[1] && process.argv[1].endsWith('avis-playwright.js') && process.argv.includes('--debug')) {
  const pickup = new Date();
  pickup.setDate(pickup.getDate() + 6);
  pickup.setHours(10, 0, 0, 0);
  const ret = new Date(pickup);
  ret.setDate(ret.getDate() + 30);
  const r = await getQuote({
    location: { code: 'DFW', name: 'DFW Airport', query: 'DFW Airport', lat: 32.9, lon: -97 },
    pickup,
    ret,
    awdCode: config.awdCode,
    rentalDays: 30,
    debugDump: true,
  });
  console.log(r);
  console.log(r.ok ? `✅ scraped $${r.priceUSD}` : '⚠️  see ./debug for screenshot+HTML to tune selectors');
}
