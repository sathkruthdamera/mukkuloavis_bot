// One-off probe: capture the live DOM of the Avis location autocomplete,
// the date calendar, and the AWD/discount popup so we can finalize selectors.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from './src/config.js';
import { contextOptions, launchArgs, applyStealth, proxyOption } from './src/stealth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'debug');
fs.mkdirSync(OUT, { recursive: true });
const dump = (name, html) => fs.writeFileSync(path.join(OUT, name), html);

const { chromium } = await import('playwright');
const ctx = await chromium.launchPersistentContext(path.join(config.paths.data, 'browser-profile'), {
  headless: true,
  args: launchArgs,
  ...contextOptions,
  ...proxyOption(),
});
await applyStealth(ctx);
const page = ctx.pages()[0] || (await ctx.newPage());
page.setDefaultTimeout(30000);

const log = (...a) => console.log(...a);

try {
  await page.goto('https://www.avis.com/en/home', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);

  // close marketing popup(s)
  for (const sel of ['a[data-click="close"]', '.bx-close-inside', '[data-testid="profile-menu-tooltip-close-btn"]']) {
    const el = page.locator(sel).first();
    if (await el.count().catch(() => 0)) await el.click({ timeout: 2000 }).catch(() => {});
  }
  await page.waitForTimeout(800);
  log('popup closed');

  // location autocomplete
  const loc = page.locator('[data-testid="pick-up-location-field-input"]').first();
  await loc.click();
  for (const ch of 'DFW Airport') await loc.type(ch, { delay: 90 });
  await page.waitForTimeout(2500);
  dump('probe_listbox.html', await page.content());
  await page.screenshot({ path: path.join(OUT, 'probe_listbox.png') });
  // report option testids/roles
  const optInfo = await page.evaluate(() => {
    const opts = [...document.querySelectorAll('li[role="option"], ul[role="listbox"] li')];
    return opts.slice(0, 6).map((o) => ({ id: o.id, testid: o.getAttribute('data-testid'), text: o.textContent.trim().slice(0, 60) }));
  });
  log('LISTBOX OPTIONS:', JSON.stringify(optInfo, null, 2));
  if (optInfo.length) {
    await page.locator('li[role="option"]').first().click().catch(() => {});
    await page.waitForTimeout(1500);
    log('selected first location option');
  }

  // open the date calendar
  const dp = page.locator('[data-testid="booking-widget-datepicker-input"]').first();
  if (await dp.count().catch(() => 0)) {
    await dp.click().catch(() => {});
    await page.waitForTimeout(2000);
    dump('probe_calendar.html', await page.content());
    await page.screenshot({ path: path.join(OUT, 'probe_calendar.png'), fullPage: true });
    const calInfo = await page.evaluate(() => {
      const dayBtns = [...document.querySelectorAll('button')].filter((b) => /^\d{1,2}$/.test(b.textContent.trim()));
      const sample = dayBtns.slice(0, 4).map((b) => ({ text: b.textContent.trim(), aria: b.getAttribute('aria-label'), cls: b.className.slice(0, 40), disabled: b.disabled }));
      const headers = [...document.querySelectorAll('[class*="MuiPickersCalendarHeader-label"], [class*="calendar"] [class*="label"]')].map((h) => h.textContent.trim()).slice(0, 4);
      return { dayCount: dayBtns.length, sample, headers };
    });
    log('CALENDAR:', JSON.stringify(calInfo, null, 2));
    await page.keyboard.press('Escape').catch(() => {});
  } else log('datepicker input not found');

  // open AWD/discount popup
  const awdTrigger = page.locator('[data-testid="discount-coupon-popup-trigger-button"]').first();
  if (await awdTrigger.count().catch(() => 0)) {
    await awdTrigger.click().catch(() => {});
    await page.waitForTimeout(1500);
    dump('probe_awd.html', await page.content());
    const awdInfo = await page.evaluate(() => {
      const ins = [...document.querySelectorAll('input')].map((i) => ({ testid: i.getAttribute('data-testid'), aria: i.getAttribute('aria-label'), name: i.name, ph: i.placeholder })).filter((x) => /awd|coupon|discount|code/i.test(JSON.stringify(x)));
      return ins;
    });
    log('AWD INPUTS:', JSON.stringify(awdInfo, null, 2));
  } else log('awd trigger not found');
} catch (e) {
  log('PROBE ERROR:', e.message);
  await page.screenshot({ path: path.join(OUT, 'probe_error.png') }).catch(() => {});
} finally {
  await ctx.close().catch(() => {});
}
