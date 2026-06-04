# 🚗 Avis Watcher

Monitors **Avis 30-day (monthly) rental prices** at every pickup location within
**150 miles of Dallas, TX**, applies your **AARP / AWD discount**, and messages you on
**Telegram** the moment a deal drops **under $900**. Runs 24/7 with a small web dashboard.

```
┌── scheduler (every 6h) ──┐
│  for each location ≤150mi │→ price 4 candidate start dates → keep lowest
│  with your AARP AWD code  │→ under $900?  → Telegram alert (deduped)
└──────────────┬───────────┘
       dashboard at http://localhost:4100
```

---

## 1. Quick start (test mode — works right now)

```bash
cd avis-watcher
npm install
npm run check        # one cycle, prints alerts to the console (mock prices)
npm start            # 24/7 + dashboard at http://localhost:4100
```

It ships with `provider=mock` so you can see the whole flow — radius filter,
multi-date pricing, budget check, alerts, dashboard — before wiring the live
scraper. Click **Check now** / **Send test alert** on the dashboard.

## 2. Turn on Telegram alerts (free, 2 min)

1. In Telegram, message **@BotFather** → `/newbot` → copy the **bot token**.
2. Message **@userinfobot** → copy your numeric **chat id**.
3. `cp .env.example .env` and set:
   ```
   TELEGRAM_BOT_TOKEN=123456:ABC...
   TELEGRAM_CHAT_ID=987654321
   NOTIFIER=telegram
   ```
4. Send your bot any message once (so it can DM you back), then:
   `npm start` → dashboard → **Send test alert**. You should get a Telegram ping.

## 3. Add your AARP discount

Your AARP benefit is an **AWD number** (Avis Worldwide Discount). Find it in your
AARP member benefits under *Travel → Avis → "your AWD code"*. Put it in `.env`:
```
AWD_CODE=A123456
```
It's injected into every Avis search so the prices you're alerted on already
reflect the AARP rate. (Without it you'll see a warning and the standard rate.)

## 4. Go live (real Avis prices)

```bash
npm i playwright
npx playwright install chromium
npm run scrape:debug      # opens DFW search; saves ./debug screenshot+HTML
```
avis.com is a JS app behind bot-detection and its HTML changes, so the scraper's
CSS selectors in `src/providers/avis-playwright.js` (the `SEL` object) **need a
one-time tune** against the live site. The debug run drops a screenshot + HTML in
`./debug/` — match the `pickupInput`, `submit`, and `priceCells` selectors to what
you see, re-run until it prints `✅ scraper returned a price`, then switch the
provider to live:
```
PROVIDER=avis        # in .env, or flip "provider" on the dashboard
```
> Tip: keep `headless:false` in `config.json` while tuning so you can watch it.

### Staying unblocked (stealth, done right)
The scraper already blends in like a normal returning visitor (`src/stealth.js`):
- strips automation tells (`navigator.webdriver`, headless fingerprints, Chromedriver markers, SwiftShader WebGL);
- realistic Chrome fingerprint — `America/Chicago` timezone, en-US, Dallas geo, normal viewport, client-hint headers;
- human-like behavior — per-keystroke typing delays, mouse wander, scrolling, randomized pauses;
- a **persistent browser profile** (`data/browser-profile`) so cookies/fingerprint survive between runs;
- requests **trickled** one location at a time with a randomized 4–12 s gap, on a non-round schedule (`37 */8 * * *` = every 8h).

**There is no permanently "undetectable" scraper** — Akamai updates, and the only
durable protection is staying low-volume and human-paced, which this does. To go
further on a cloud server, add a **residential proxy** (`PROXY_URL` in `.env`) since
datacenter IPs get flagged fastest, and keep the cadence at 8h+ rather than minutes.
This is intended for your own personal-rental monitoring; don't scale it up.

## 5. Run it 24/7 on a cloud server

Any cheap Linux VPS works (Telegram sends fine from the cloud — no Mac needed):
```bash
# on the server
git clone <your repo> && cd avis-watcher
npm install && npm i playwright && npx playwright install --with-deps chromium
cp .env.example .env   # fill in TELEGRAM_*, AWD_CODE, PROVIDER=avis
# keep it alive with pm2:
npm i -g pm2 && pm2 start src/index.js --name avis-watcher && pm2 save && pm2 startup
```
Tune cadence with `checkIntervalCron` in `config.json` (default `0 */6 * * *` =
every 6h). Don't hammer Avis — every 4–12h is plenty for weekly price swings.

---

## Real-Chrome agent (best free way past PerimeterX)

Avis uses PerimeterX bot-detection that 403s automated/headless browsers on
datacenter IPs. The free way around it is to drive your **own everyday Chrome**:
real fingerprint, your home IP, your warmed cookies, no `navigator.webdriver`.

1. **Set up** (Windows): copy `.env.example` to `.env`, then set:
   ```
   PROVIDER=avis
   NOTIFIER=telegram
   CHROME_CDP_URL=http://localhost:9222
   TELEGRAM_BOT_TOKEN=...
   TELEGRAM_CHAT_ID=...
   AWD_CODE=A359824
   ```
2. **Launch real Chrome with the debug port** — double-click
   `deploy\start-chrome-debug.bat`. It opens a dedicated Chrome on avis.com.
   Browse around Avis once so it earns PerimeterX cookies. **Leave it open.**
3. **Test one check** — double-click `deploy\run-agent.bat` (or
   `node src/index.js --once --report`). You get a Telegram verdict: real prices
   or still blocked.
4. **Run hourly while your PC is on** — `npm start` (checks every hour via the
   built-in schedule and nudges on a sub-$900 hit), or schedule `run-agent.bat`
   hourly in Windows Task Scheduler.

> Tradeoff: this needs a real browser + real connection, so it only runs while
> your PC and that Chrome are open. For 24/7 coverage when your PC is off, keep
> the free GitHub Actions reminder below as a fallback.

## Run it hourly for free with GitHub Actions

A scheduled workflow (`.github/workflows/avis-watch.yml`) runs one check every hour
and pings Telegram on a qualifying deal — no server, no PC left on.

1. **Push this project to a GitHub repo** (`.env` is git-ignored, so your token
   never gets committed — secrets live in GitHub instead).
2. **Add repo secrets** — Settings → Secrets and variables → Actions → *New
   repository secret*:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
   - `AWD_CODE`  (e.g. `A359824`)
   - `PROXY_URL` *(optional but recommended — see caveat below)*
   ```bash
   # or with the GitHub CLI:
   gh secret set TELEGRAM_BOT_TOKEN -b"8813410183:AAH..."
   gh secret set TELEGRAM_CHAT_ID  -b"5833163993"
   gh secret set AWD_CODE          -b"A359824"
   ```
3. **Enable + test** — open the **Actions** tab, pick *Avis Watcher*, click
   **Run workflow** to test on demand. After that it runs hourly automatically.

State (dedupe + cookies) is persisted between the ephemeral runs via `actions/cache`,
so you won't be re-alerted for the same deal every hour.

> ⚠️ **Big caveat — datacenter IPs.** GitHub's runners use Azure datacenter IPs,
> which Avis's bot-detection flags far more aggressively than a home connection.
> The scheduler is perfect; the *scrape* may get challenged and return no prices.
> If that happens, either add a **residential `PROXY_URL`** (not free) or run on
> your own PC / a home device (residential IP = least likely to be blocked).
> Also note: GitHub may delay scheduled runs by a few minutes, runs in **UTC**,
> and **disables scheduled workflows after 60 days** with no repo commits.

## Settings (`config.json` or the dashboard)

| Setting | Meaning | Default |
|---|---|---|
| `budgetUSD` | Alert when total ≤ this | `900` |
| `rentalDays` | Rental length | `30` |
| `radiusMiles` | Pickup search radius from `origin` | `150` |
| `origin` | Center point (Dallas) | Dallas, TX |
| `startDateStrategy` | How many start dates to price each run | 4 dates, 1 wk apart |
| `checkIntervalCron` | How often to check | every 6h |
| `alertCooldownHours` | Don't re-alert same deal within | `24` |
| `provider` | `mock` or `avis` | `mock` |
| `notifier` | `telegram` / `pushover` / `imessage` / `console` | `telegram` |

Pickup locations live in `src/locations.js` — add/remove cities freely; anything
beyond `radiusMiles` is auto-skipped.

## Other alert channels (optional)
- **Pushover** — set `PUSHOVER_USER`/`PUSHOVER_TOKEN`, `NOTIFIER=pushover`.
- **iMessage** — needs an always-on **Mac**. If this app runs on the Mac, set
  `IMESSAGE_TO` and `NOTIFIER=imessage` (it uses `osascript`). If the app runs on
  a cloud server, run a tiny relay on your Mac and point `IMESSAGE_RELAY_URL` at
  it. (Linux servers cannot send iMessage on their own — that's an Apple limit.)

## Notes & limits
- No official Avis price API exists; live mode automates the public site. Use it
  for your own personal-rental monitoring and keep the cadence gentle.
- Mock mode is for testing the pipeline only — those prices are synthetic.
