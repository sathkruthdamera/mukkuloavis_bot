// Stealth + human-like behavior so low-volume personal automation reads as a
// normal returning visitor rather than a bot. No guarantees against an updating
// anti-bot system — the real protection is LOW VOLUME (one quiet pass every few
// hours) plus a persistent profile. Keep it gentle.
import config from './config.js';

const REAL_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export const contextOptions = {
  userAgent: REAL_UA,
  locale: 'en-US',
  timezoneId: 'America/Chicago',
  viewport: { width: 1366, height: 864 },
  deviceScaleFactor: 1,
  isMobile: false,
  hasTouch: false,
  colorScheme: 'light',
  geolocation: { latitude: 32.7767, longitude: -96.797 }, // Dallas
  permissions: [],
  extraHTTPHeaders: {
    'accept-language': 'en-US,en;q=0.9',
    'sec-ch-ua': '"Chromium";v="126", "Google Chrome";v="126", "Not.A/Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'upgrade-insecure-requests': '1',
  },
};

// Launch flags: strip automation tells + keep headless Chromium stable on the
// heavy Avis results page (the renderer crashes without --disable-dev-shm-usage).
export const launchArgs = [
  '--disable-blink-features=AutomationControlled',
  '--disable-features=IsolateOrigins,site-per-process',
  '--no-default-browser-check',
  '--no-first-run',
  '--disable-infobars',
  '--start-maximized',
  // stability (prevents "page crash" on memory-heavy pages)
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-software-rasterizer',
  '--no-sandbox',
  '--js-flags=--max-old-space-size=2048',
];

// Injected into every page BEFORE site JS runs — patches the JS fingerprint.
export async function applyStealth(context) {
  await context.addInitScript(() => {
    // navigator.webdriver -> undefined
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    // plausible plugins + mimeTypes
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
    // chrome runtime object that real Chrome exposes
    window.chrome = window.chrome || { runtime: {}, app: {}, csi: () => {}, loadTimes: () => {} };
    // permissions.query notifications quirk used by detectors
    const origQuery = window.navigator.permissions && window.navigator.permissions.query;
    if (origQuery) {
      window.navigator.permissions.query = (p) =>
        p && p.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : origQuery(p);
    }
    // WebGL vendor/renderer spoof (headless often leaks SwiftShader)
    const getParam = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (p) {
      if (p === 37445) return 'Google Inc. (Intel)';
      if (p === 37446) return 'ANGLE (Intel, Intel(R) UHD Graphics, OpenGL 4.5)';
      return getParam.call(this, p);
    };
    // strip Chromedriver markers
    for (const k of Object.keys(window)) if (/^(cdc_|\$cdc)/.test(k)) delete window[k];
  });
}

// ---- human-like helpers (bounded randomness; volume stays tiny) ----
const rint = (min, max) => Math.floor(min + Math.random() * (max - min));
export const jitter = (page, min = 400, max = 1400) => page.waitForTimeout(rint(min, max));

export async function humanType(locator, text, page) {
  await locator.click();
  for (const ch of text) {
    await locator.type(ch, { delay: rint(60, 180) });
  }
  await page.waitForTimeout(rint(150, 500));
}

export async function humanWander(page) {
  try {
    for (let i = 0; i < rint(2, 4); i++) {
      await page.mouse.move(rint(80, 1200), rint(120, 700), { steps: rint(5, 15) });
      await page.waitForTimeout(rint(120, 420));
    }
    await page.mouse.wheel(0, rint(120, 600));
  } catch {}
}

export function proxyOption() {
  const url = config.playwright?.proxyUrl || process.env.PROXY_URL;
  return url ? { proxy: { server: url } } : {};
}
