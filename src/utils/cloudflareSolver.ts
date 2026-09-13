// src/utils/cloudflareSolver.ts
//
// In-process Cloudflare challenge solver using a headless Chromium browser
// (playwright-core, pointed at the system Chromium installed via apk in the
// Docker image — see Dockerfile). Alpine/musl can't run Playwright's own
// downloaded glibc browser build, so we launch the apk-installed binary
// directly. Only one browser instance is ever in flight at a time, with a
// hard timeout, and a permanent "give up" mode if Chromium can't launch at
// all in this environment (so a broken install is never retried on every
// request).
//
// Usage: call getOrSolveClearance(url) BEFORE the circuit breaker trips.
// If it returns a clearance pair, retry the original request once with:
//   headers: { Cookie: clearance.cookie, 'User-Agent': clearance.userAgent }
// If it returns null, fall through to the existing circuit-breaker logic
// unchanged — this module never throws to the caller.

import { access, constants as fsConstants } from 'node:fs/promises';
import type { Browser, BrowserContext } from 'playwright-core';
import { globalCache } from './cache.js';
import { isCaptchaChallenge } from './captcha.js';
import { Logger } from './logger.js';

const logger = new Logger('CloudflareSolver');

export interface ClearancePair {
  /** Full cookie header value, e.g. "cf_clearance=xxxxx" */
  cookie: string;
  /** The exact User-Agent the solving browser used — must be reused verbatim */
  userAgent: string;
}

const CACHE_TTL_SECONDS = 2 * 60 * 60; // 2h fallback if the cookie has no usable expiry
const SOLVE_TIMEOUT_MS = 22_000;
const NAV_TIMEOUT_MS = 15_000;

// Candidate Chromium binaries, in priority order.
// CHROMIUM_PATH is set in the Dockerfile to the apk-installed system
// Chromium (Alpine ships musl, not glibc, so Playwright's own downloaded
// builds won't run there). Falls through to undefined for local dev
// machines where `npx playwright install chromium` was run — playwright-core
// will then use its own managed browser instead.
const CHROMIUM_CANDIDATES = [
  process.env.CHROMIUM_PATH,
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter((p): p is string => Boolean(p));

let cachedExecutablePath: string | undefined | null = null; // null = not resolved yet

async function resolveExecutablePath(): Promise<string | undefined> {
  if (cachedExecutablePath !== null) return cachedExecutablePath;
  for (const candidate of CHROMIUM_CANDIDATES) {
    try {
      await access(candidate, fsConstants.X_OK);
      cachedExecutablePath = candidate;
      return candidate;
    } catch {
      // try next candidate
    }
  }
  cachedExecutablePath = undefined; // let playwright-core fall back to its own managed browser
  return undefined;
}

let chromiumUnavailable = false; // once true, stays true for process lifetime
let inFlight: Promise<ClearancePair | null> | null = null;

function cacheKey(hostname: string): string {
  return `cfsolver:clearance:${hostname}`;
}

export async function getOrSolveClearance(targetUrl: string): Promise<ClearancePair | null> {
  const hostname = new URL(targetUrl).hostname;

  const cached = globalCache.get<ClearancePair>(cacheKey(hostname));
  if (cached) return cached;

  if (chromiumUnavailable) return null;

  // Global mutex (not per-hostname): this host has ~512MB RAM on the free
  // tier, so only one Chromium instance is ever allowed in flight. Callers
  // for other hostnames simply wait for the current solve to finish.
  if (inFlight) return inFlight;

  inFlight = solveOnce(targetUrl, hostname).finally(() => {
    inFlight = null;
  });

  return inFlight;
}

async function solveOnce(targetUrl: string, hostname: string): Promise<ClearancePair | null> {
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  try {
    const executablePath = await resolveExecutablePath();
    const { chromium } = await import('playwright-core');

    browser = await withTimeout(
      chromium.launch({
        headless: true,
        executablePath,
        args: [
          '--disable-gpu',
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--disable-setuid-sandbox',
        ],
      }),
      SOLVE_TIMEOUT_MS,
      'chromium launch'
    );

    context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
    page.setDefaultTimeout(NAV_TIMEOUT_MS);

    await withTimeout(
      page.goto(targetUrl, { waitUntil: 'domcontentloaded' }),
      SOLVE_TIMEOUT_MS,
      'initial navigation'
    );

    const deadline = Date.now() + SOLVE_TIMEOUT_MS;
    let cleared = false;

    while (Date.now() < deadline) {
      const html = await page.content();
      if (!isCaptchaChallenge(html, 200)) {
        cleared = true;
        break;
      }
      await page.waitForTimeout(1000);
    }

    if (!cleared) {
      await safeClose(browser);
      return null;
    }

    const cookies = await context.cookies(targetUrl);
    const clearanceCookie = cookies.find((c) => c.name === 'cf_clearance');
    if (!clearanceCookie) {
      await safeClose(browser);
      return null;
    }

    const userAgent = await page.evaluate(() => navigator.userAgent);
    const pair: ClearancePair = {
      cookie: `cf_clearance=${clearanceCookie.value}`,
      userAgent,
    };

    const ttlSeconds =
      clearanceCookie.expires && clearanceCookie.expires > 0
        ? Math.max(60, Math.floor(clearanceCookie.expires - Date.now() / 1000))
        : CACHE_TTL_SECONDS;

    globalCache.set(cacheKey(hostname), pair, ttlSeconds);
    await safeClose(browser);
    logger.info(`Solved Cloudflare challenge for ${hostname}; cached for ${Math.round(ttlSeconds / 60)}m.`);
    return pair;
  } catch (err) {
    if (isLaunchFailure(err)) {
      chromiumUnavailable = true;
      logger.warn(
        `Chromium unavailable in this environment (${(err as Error).message}); disabling solver for the rest of this process lifetime.`
      );
    } else {
      logger.warn(`Challenge solve failed for ${hostname}: ${(err as Error).message}`);
    }
    await safeClose(browser);
    return null;
  }
}

function isLaunchFailure(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("Executable doesn't exist") ||
    msg.includes('browserType.launch') ||
    msg.includes('Failed to launch') ||
    msg.includes('error while loading shared libraries')
  );
}

async function safeClose(browser: Browser | null): Promise<void> {
  if (!browser) return;
  try {
    await browser.close();
  } catch {
    // best-effort cleanup
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}
