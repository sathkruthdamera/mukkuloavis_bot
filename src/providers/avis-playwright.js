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
      document
        .querySelectorAll('[id^="bx-campaign"], [class*="bx-overlay"], #bx-overlay-1843691, [class*="bxc"]')
        .forEach((n) => n.remove());
    })
    .catch(() => {});
}

async function clickDay(page, date) {
  const want = dayLabel(date);
  for (let i = 0; i < 14; i++) {
    const el = page.locator(`button.rdp-day_button[aria-label*="${want}"]`).first();
    if ((await el.count().catch(() => 0)) && (await el.isVisible().catch(() => false)) && !(await el.isDisabled().catch(() => true))) {
      await el.click();
      return true;
    }
    const next = page.locator('.rdp-button_next').first();
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

// Pull plausible 30-day totals out of the vehicles API JSON. We don't have a
// confirmed schema (only ever got the 403), so walk the object generically and
// collect numbers under price-like keys, bounded to a sane 30-day-total range.
function parsePricesFromJson(text) {
  const out = [];
  const KEY = /(total|amount|price|payNow|payLater|grandTotal|estimatedTotal|rate)/i;
  try {
    const data = JSON.parse(text);
    const walk = (node, keyHint) => {
      if (node == null) return;
      if (typeof node === 'number') {
        if (KEY.test(keyHint || '') && node >= 200 && node <= 20000) out.push(node);
        return;
      }
      if (typeof node === 'string') {
        const m = node.match(/^\$?\s?([\d,]+(?:\.\d{2})?)$/);
        if (m && KEY.test(keyHint || '')) {
          const v = Number(m[1].replace(/,/g, ''));
          if (v >= 200 && v <= 20000) out.push(v);
        }
        return;
      }
      if (Array.isArray(node)) { node.forEach((v) => walk(v, keyHint)); return; }
      if (typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, k);
    };
    walk(data, '');
  } catch {
    // not JSON — fall back to scanning for "$" amounts in a total-ish range
    for (const m of text.matchAll(/\$\s?([\d,]+(?:\.\d{2})?)/g)) {
      const v = Number(m[1].replace(/,/g, ''));
      if (v >= 200 && v <= 20000) out.push(v);
    }
  }
  return out;
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
  if (attached) {
    browser = await chromium.connectOverCDP(cdpUrl);
    ctx = browser.contexts()[0] || (await browser.newContext());
    page = await ctx.newPage(); // a new tab in your real Chrome (don't stealth-patch the shared context)
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
  const tag = `${location.code}_${fmt(pickup)}`;
  const warnings = [];
  try {
    const DBG = process.argv.includes('--debug');
    const mark = (s) => DBG && console.error(`  · step: ${s}`);
    page.on('close', () => DBG && console.error('  !! page closed event'));
    page.on('crash', () => DBG && console.error('  !! page CRASH event'));
    mark('goto');
    await page.goto(HOME, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await closePopups(page);
    await humanWander(page);
    mark('home-ready');

    // 1) pickup location (re-nuke any late popup, force past any overlay)
    const loc = page.locator('[data-testid="pick-up-location-field-input"]').first();
    await loc.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
    await closePopups(page);
    if (!(await loc.count().catch(() => 0))) throw new Error('pickup-input-not-found');
    await loc.click({ force: true }).catch(() => {});
    for (const ch of location.query) await loc.type(ch, { delay: 90 });
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

    // 3) dates: open picker, click pickup then return day
    mark('awd-done -> dates');
    const dp = page.locator('[data-testid="booking-widget-datepicker-input"]').first();
    if (await dp.count().catch(() => 0)) { await dp.click().catch(() => {}); await page.waitForTimeout(1200); }
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

    // PerimeterX block detection
    if (status === 403 || /"appId"\s*:\s*"PX|captcha\.px-cloud|blockScript/.test(body)) {
      return { ok: false, blocked: true, error: 'blocked-perimeterx-403', warnings, detail: location.name };
    }
    if (status >= 400) {
      await dumpDebug(page, `httperr_${tag}`);
      return { ok: false, error: `vehicles-http-${status}`, warnings, detail: location.name };
    }

    const prices = parsePricesFromJson(body);
    if (!prices.length) {
      if (debugDump) { fs.mkdirSync(config.paths.debug, { recursive: true }); fs.writeFileSync(path.join(config.paths.debug, `vehicles_${tag}.json`), body); }
      throw new Error('no-prices-in-json');
    }
    const priceUSD = Math.min(...prices);
    return {
      ok: true,
      priceUSD,
      carClass: 'lowest available',
      currency: 'USD',
      url: page.url(),
      warnings,
      detail: `${location.name} · ${fmt(pickup)}..${fmt(ret)} · ${rentalDays}d${awdCode && !warnings.includes('awd-not-applied') ? ' · AARP' : ''}`,
    };
  } catch (err) {
    await dumpDebug(page, `error_${tag}`);
    return { ok: false, error: String(err.message || err), warnings, detail: location.name };
  } finally {
    if (attached) {
      // Only close the tab we opened, then disconnect — leave your Chrome running.
      await page.close().catch(() => {});
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
