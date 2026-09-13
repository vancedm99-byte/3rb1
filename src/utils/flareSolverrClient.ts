// src/utils/flareSolverrClient.ts
//
// FlareSolverr REST API Client
// Interfaces with a FlareSolverr sidecar container (ghcr.io/flaresolverr/flaresolverr:latest)
// listening on port 8191 to solve Cloudflare Bot Management / Managed Challenges.
//
// Clearance cookies and User-Agent are extracted and cached per-domain with a 20m TTL.

import { globalCache } from './cache.js';
import { Logger } from './logger.js';

const logger = new Logger('FlareSolverrClient');

export interface FlareSolverrCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
}

export interface FlareSolverrSolution {
  cookies: FlareSolverrCookie[];
  userAgent: string;
}

// In-flight deduplication: map domain to active solve promise
const inFlightSolves = new Map<string, Promise<FlareSolverrSolution>>();

// 20 minutes clearance TTL (matches Cloudflare clearance validity window)
const CLEARANCE_CACHE_TTL_SECONDS = 20 * 60;

/**
 * Resolves the configured FlareSolverr base URL from environment variables.
 * Supports FLARESOLVERR_URL, Render's hostport property, or host property.
 */
export function getFlareSolverrBaseUrl(): string {
  const raw =
    process.env.FLARESOLVERR_URL ||
    (process.env.FLARESOLVERR_HOSTPORT ? `http://${process.env.FLARESOLVERR_HOSTPORT}` : '') ||
    (process.env.FLARESOLVERR_HOST ? `http://${process.env.FLARESOLVERR_HOST}:8191` : '');

  if (!raw) return '';
  const trimmed = raw.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed.replace(/\/+$/, '');
  }
  return `http://${trimmed}`.replace(/\/+$/, '');
}

/**
 * Checks whether the FlareSolverr sidecar URL is configured in the environment.
 */
export function isFlareSolverrConfigured(): boolean {
  return Boolean(getFlareSolverrBaseUrl());
}

/**
 * Solves a Cloudflare challenge for the given target URL via FlareSolverr.
 * Extracts only solution.cookies and solution.userAgent (never parses solution.response).
 * Caches clearance per-domain with a 20-minute TTL.
 * Fails closed with an explicit error and log if FLARESOLVERR_URL is unset.
 */
export async function solveChallenge(url: string): Promise<FlareSolverrSolution> {
  const baseUrl = getFlareSolverrBaseUrl();

  if (!baseUrl) {
    logger.error('FLARESOLVERR_URL is not configured. FlareSolverr sidecar is unavailable; failing closed.');
    throw new Error('FLARESOLVERR_URL is not configured; cannot solve Cloudflare challenge.');
  }

  let domain: string;
  try {
    domain = new URL(url).hostname.toLowerCase();
  } catch {
    domain = url.toLowerCase();
  }

  const cacheKey = `flaresolverr:clearance:${domain}`;

  // Check 20m domain-level cache
  const cached = globalCache.get<FlareSolverrSolution>(cacheKey);
  if (cached && cached.cookies.length > 0 && cached.userAgent) {
    logger.debug(`Using cached FlareSolverr clearance for ${domain} (${cached.cookies.length} cookies)`);
    return cached;
  }

  // Deduplicate concurrent solve attempts for the same domain
  if (inFlightSolves.has(domain)) {
    logger.debug(`Reusing in-flight FlareSolverr solve promise for ${domain}`);
    return inFlightSolves.get(domain)!;
  }

  const solvePromise = (async () => {
    try {
      logger.info(`Sending challenge solve request to FlareSolverr for ${url} (target: ${baseUrl}/v1)...`);
      const endpoint = `${baseUrl}/v1`;

      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          cmd: 'request.get',
          url,
          maxTimeout: 60000,
        }),
        signal: AbortSignal.timeout(65000),
      });

      if (!resp.ok) {
        const errorText = await resp.text().catch(() => '');
        throw new Error(`FlareSolverr returned HTTP ${resp.status} ${resp.statusText}: ${errorText.slice(0, 300)}`);
      }

      const rawData = (await resp.json()) as any;

      if (rawData.status !== 'ok' || !rawData.solution) {
        const errorMsg = rawData.message || `FlareSolverr response status was "${rawData.status}"`;
        throw new Error(`FlareSolverr failed to solve challenge: ${errorMsg}`);
      }

      const solution: FlareSolverrSolution = {
        cookies: Array.isArray(rawData.solution.cookies) ? rawData.solution.cookies : [],
        userAgent: rawData.solution.userAgent || '',
      };

      if (solution.cookies.length === 0 && !solution.userAgent) {
        throw new Error('FlareSolverr solution contained neither cookies nor userAgent.');
      }

      logger.info(
        `FlareSolverr solved challenge for ${domain}: ${solution.cookies.length} cookies obtained, UA: ${solution.userAgent}`
      );

      // Cache clearance per domain for 20 minutes
      globalCache.set(cacheKey, solution, CLEARANCE_CACHE_TTL_SECONDS);

      return solution;
    } finally {
      inFlightSolves.delete(domain);
    }
  })();

  inFlightSolves.set(domain, solvePromise);
  return solvePromise;
}

/**
 * Diagnostic helper to execute a raw request to FlareSolverr /v1
 * Returns the raw JSON response payload for observability and testing.
 */
export async function solveChallengeRaw(url: string): Promise<any> {
  const baseUrl = getFlareSolverrBaseUrl();
  if (!baseUrl) {
    throw new Error('FLARESOLVERR_URL is not configured');
  }

  const endpoint = `${baseUrl}/v1`;
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cmd: 'request.get',
      url,
      maxTimeout: 60000,
    }),
    signal: AbortSignal.timeout(65000),
  });

  return await resp.json();
}

/**
 * Resets cached clearance and in-flight tracking (primarily for testing).
 */
export function resetFlareSolverrStateForTesting(): void {
  inFlightSolves.clear();
}
