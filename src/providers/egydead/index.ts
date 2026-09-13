import { BaseProvider } from '../base.js';
import { ProviderCatalogDefinition, ProviderDetail, ProviderEpisode, ProviderItem, ResolvedStream } from '../../types/provider.js';
import { StremioContentType } from '../../types/stremio.js';
import { http, HttpResponse, DEFAULT_USER_AGENT, MOBILE_USER_AGENT } from '../../utils/http.js';
import { extractStreams } from '../../extractors/index.js';
import { isCaptchaChallenge } from '../../utils/captcha.js';
import { globalCache } from '../../utils/cache.js';
import { getOrSolveClearance, isSolverDegraded } from '../../utils/cloudflareSolver.js';
import { solveChallenge, isFlareSolverrConfigured } from '../../utils/flareSolverrClient.js';

interface MtdbVideo {
  id: number;
  name?: string;
  src?: string;
  quality?: string;
  type?: string;
  category?: string;
  episode_id?: number | null;
  season_num?: number | null;
  episode_num?: number | null;
}

interface MtdbTitle {
  id: number;
  name: string;
  original_title?: string;
  description?: string;
  poster?: string;
  backdrop?: string;
  is_series?: boolean;
  type?: string;
  year?: number;
  release_date?: string;
  videos?: MtdbVideo[];
  primary_video?: MtdbVideo;
}

interface MtdbEpisode {
  id: number;
  name?: string;
  description?: string;
  poster?: string;
  season_number?: number;
  episode_number?: number;
  primary_video?: MtdbVideo;
}

interface MtdbSeason {
  id: number;
  number: number;
  episodes_count?: number;
}

export class EgydeadProvider extends BaseProvider {
  id = 'egydead';
  name = 'Egydead (إيجي ديد)';
  lang = 'ar';
  mainUrl = 'https://egydead.ca';
  supportedTypes: StremioContentType[] = ['movie', 'series'];
  requiresBrowserSolver: boolean = true;

  // Mirror domains tracked for fallback
  mirrors: string[] = [
    'https://egydead.ca',
    'https://egydead.live',
    'https://tv10.egydead.live',
    'https://egydead.beer',
  ];

  // In-memory per-mirror health tracking (isolated to Egydead)
  private mirrorHealth: Map<string, { url: string; lastSuccess: number; lastChallenge: number; consecutiveFailures: number }> = new Map();

  // Circuit breaker constants for Cloudflare bot challenge mitigation
  private readonly CONSECUTIVE_CHALLENGE_THRESHOLD = 3;
  private readonly COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes
  private consecutiveChallenges: number = 0;
  private cooldownUntil: number = 0;

  constructor() {
    super();
    this.initLogger();
  }

  isDegraded(): boolean {
    if (this.requiresBrowserSolver && isSolverDegraded()) {
      return true;
    }
    return Date.now() < this.cooldownUntil;
  }

  getCooldownRemainingMs(): number {
    return Math.max(0, this.cooldownUntil - Date.now());
  }

  resetCooldown(): void {
    this.consecutiveChallenges = 0;
    this.cooldownUntil = 0;
  }

  private isCooldownActive(): boolean {
    if (Date.now() < this.cooldownUntil) {
      return true;
    }
    if (this.cooldownUntil > 0) {
      this.logger.info(
        `Egydead cooldown period expired. Probing upstream endpoint to test Cloudflare challenge status...`
      );
      this.cooldownUntil = 0;
    }
    return false;
  }

  recordChallengeFailure(): void {
    this.consecutiveChallenges++;
    if (this.consecutiveChallenges >= this.CONSECUTIVE_CHALLENGE_THRESHOLD) {
      this.cooldownUntil = Date.now() + this.COOLDOWN_MS;
      this.logger.warn(
        `Egydead paused for 10m after ${this.consecutiveChallenges} consecutive Cloudflare challenges (cooldown active until ${new Date(this.cooldownUntil).toISOString()})`
      );
    }
  }

  recordSuccess(): void {
    if (this.consecutiveChallenges > 0 || this.cooldownUntil > 0) {
      this.logger.info(`Egydead connection healthy; Cloudflare challenge counter reset.`);
    }
    this.consecutiveChallenges = 0;
    this.cooldownUntil = 0;
  }

  getOrderedCandidateMirrors(): string[] {
    return [...this.mirrors].sort((a, b) => {
      const cleanA = a.replace(/\/+$/, '');
      const cleanB = b.replace(/\/+$/, '');
      const ha = this.mirrorHealth.get(cleanA) || { url: cleanA, lastSuccess: 0, lastChallenge: 0, consecutiveFailures: 0 };
      const hb = this.mirrorHealth.get(cleanB) || { url: cleanB, lastSuccess: 0, lastChallenge: 0, consecutiveFailures: 0 };

      const aChallenged = ha.lastChallenge > ha.lastSuccess && ha.lastChallenge > 0;
      const bChallenged = hb.lastChallenge > hb.lastSuccess && hb.lastChallenge > 0;

      // Unchallenged mirrors always precede challenged ones
      if (!aChallenged && bChallenged) return -1;
      if (aChallenged && !bChallenged) return 1;

      // Prefer the most recently healthy mirror
      if (ha.lastSuccess !== hb.lastSuccess) {
        return hb.lastSuccess - ha.lastSuccess;
      }

      // Prefer mirror with fewer consecutive failures
      if (ha.consecutiveFailures !== hb.consecutiveFailures) {
        return ha.consecutiveFailures - hb.consecutiveFailures;
      }

      return this.mirrors.indexOf(a) - this.mirrors.indexOf(b);
    });
  }

  recordMirrorSuccess(mirrorUrl: string): void {
    const clean = mirrorUrl.replace(/\/+$/, '');
    const h = this.mirrorHealth.get(clean) || { url: clean, lastSuccess: 0, lastChallenge: 0, consecutiveFailures: 0 };
    h.lastSuccess = Date.now();
    h.consecutiveFailures = 0;
    this.mirrorHealth.set(clean, h);
  }

  recordMirrorChallenge(mirrorUrl: string): void {
    const clean = mirrorUrl.replace(/\/+$/, '');
    const h = this.mirrorHealth.get(clean) || { url: clean, lastSuccess: 0, lastChallenge: 0, consecutiveFailures: 0 };
    h.lastChallenge = Date.now();
    h.consecutiveFailures++;
    this.mirrorHealth.set(clean, h);
  }

  getMirrorHealth(mirrorUrl: string) {
    const clean = mirrorUrl.replace(/\/+$/, '');
    return this.mirrorHealth.get(clean) || { url: clean, lastSuccess: 0, lastChallenge: 0, consecutiveFailures: 0 };
  }

  private getBrowserHeaders(isApi: boolean = true, mirrorUrl?: string): Record<string, string> {
    const origin = (mirrorUrl || this.mainUrl).replace(/\/+$/, '');
    return {
      'User-Agent': DEFAULT_USER_AGENT,
      'Accept': isApi
        ? 'application/json, text/plain, */*'
        : 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
      'Referer': `${origin}/`,
      'Origin': origin,
      'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'Sec-Fetch-Dest': isApi ? 'empty' : 'document',
      'Sec-Fetch-Mode': isApi ? 'cors' : 'navigate',
      'Sec-Fetch-Site': 'same-origin',
      'Priority': 'u=1, i',
    };
  }

  private async requestWithRetry(
    urlOrPath: string,
    options: { isApi?: boolean; timeout?: number; maxRetries?: number } = {}
  ): Promise<HttpResponse<any>> {
    const isApi = options.isApi ?? true;
    const timeout = options.timeout ?? 8000;
    const maxRetries = options.maxRetries ?? 1;

    let pathAndQuery: string;
    if (urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://')) {
      try {
        const parsed = new URL(urlOrPath);
        pathAndQuery = `${parsed.pathname}${parsed.search}`;
      } catch {
        pathAndQuery = urlOrPath.startsWith('/') ? urlOrPath : `/${urlOrPath}`;
      }
    } else {
      pathAndQuery = urlOrPath.startsWith('/') ? urlOrPath : `/${urlOrPath}`;
    }

    const candidateMirrors = this.getOrderedCandidateMirrors();
    let lastResp: HttpResponse<any> | null = null;
    let lastError: Error | null = null;
    let challengedMirrorsCount = 0;

    for (const mirror of candidateMirrors) {
      const cleanMirror = mirror.replace(/\/+$/, '');
      const fullUrl = `${cleanMirror}${pathAndQuery}`;

      for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
        const headers = this.getBrowserHeaders(isApi, cleanMirror);
        if (attempt > 1) {
          headers['Cache-Control'] = 'no-cache';
        }

        try {
          const resp = await http.get(fullUrl, { headers, timeout });
          lastResp = resp;

          if (!isCaptchaChallenge(resp.text, resp.status)) {
            // Mirror answered cleanly without Cloudflare challenge
            this.recordMirrorSuccess(cleanMirror);
            this.mainUrl = cleanMirror;
            this.recordSuccess();
            this.logger.debug(
              `[Egydead] Request to ${pathAndQuery} successfully served by mirror ${cleanMirror}`
            );
            return resp;
          }

          // Cloudflare challenge detected. If this provider declared requiresBrowserSolver: true and cooldown is not active,
          // attempt to solve the challenge before tripping the circuit breaker.
          if (this.requiresBrowserSolver && attempt === 1 && !this.isCooldownActive()) {
            if (isFlareSolverrConfigured()) {
              try {
                this.logger.info(
                  `[Egydead] Cloudflare challenge encountered for ${cleanMirror} (${pathAndQuery}); invoking FlareSolverr sidecar...`
                );
                const solution = await solveChallenge(fullUrl);

                // Apply returned clearance cookies to the domain's session in HttpClient cookie jar
                const domain = new URL(fullUrl).hostname;
                for (const c of solution.cookies) {
                  http.setCookie(c.name, c.value, c.domain || domain);
                }

                // Retry original request using the EXACT matching User-Agent FlareSolverr used (UA-bound cookies)
                const retryHeaders: Record<string, string> = {
                  ...headers,
                  'User-Agent': solution.userAgent,
                };
                if (solution.cookies.length > 0) {
                  retryHeaders['Cookie'] = solution.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
                }

                const retryResp = await http.get(fullUrl, { headers: retryHeaders, timeout });
                if (!isCaptchaChallenge(retryResp.text, retryResp.status)) {
                  this.recordMirrorSuccess(cleanMirror);
                  this.mainUrl = cleanMirror;
                  this.recordSuccess();
                  this.logger.info(
                    `[Egydead] Cloudflare challenge successfully solved via FlareSolverr for ${cleanMirror}; request succeeded.`
                  );
                  return retryResp;
                }
                lastResp = retryResp;
              } catch (flareErr) {
                this.logger.warn(
                  `[Egydead] FlareSolverr challenge solve failed for ${cleanMirror}: ${(flareErr as Error).message}`
                );
                // Fall through to existing per-provider retry and circuit-breaker behavior
              }
            } else {
              // Local Playwright solver fallback (when FLARESOLVERR_URL is unset, e.g. local dev with Chromium)
              try {
                const clearance = await getOrSolveClearance(fullUrl, this.id);
                if (clearance) {
                  const retryHeaders = {
                    ...headers,
                    Cookie: clearance.cookie,
                    'User-Agent': clearance.userAgent,
                  };
                  const retryResp = await http.get(fullUrl, { headers: retryHeaders, timeout });
                  if (!isCaptchaChallenge(retryResp.text, retryResp.status)) {
                    this.recordMirrorSuccess(cleanMirror);
                    this.mainUrl = cleanMirror;
                    this.recordSuccess();
                    this.logger.info(
                      `[Egydead] Cloudflare challenge solved via local Playwright for ${cleanMirror}; request succeeded.`
                    );
                    return retryResp;
                  }
                  lastResp = retryResp;
                }
              } catch (localSolveErr) {
                this.logger.debug(
                  `[Egydead] Local Playwright clearance retry failed for ${cleanMirror}: ${(localSolveErr as Error).message}`
                );
              }
            }
          }

          if (attempt <= maxRetries) {
            this.logger.debug(
              `[Egydead] Mirror ${cleanMirror} challenge (attempt ${attempt}/${maxRetries + 1}) for ${pathAndQuery}; retrying with backoff...`
            );
            await new Promise((r) => setTimeout(r, 1000));
          }
        } catch (err) {
          lastError = err as Error;
          this.logger.debug(
            `[Egydead] Mirror ${cleanMirror} error on attempt ${attempt} for ${pathAndQuery}: ${(err as Error).message}`
          );
          if (attempt <= maxRetries) {
            await new Promise((r) => setTimeout(r, 1000));
          }
        }
      }

      // This candidate mirror failed or was challenged across attempts; record and rotate
      challengedMirrorsCount++;
      this.recordMirrorChallenge(cleanMirror);
      this.logger.debug(
        `[Egydead] Mirror ${cleanMirror} challenged/failed for ${pathAndQuery}; rotating to next candidate mirror (${challengedMirrorsCount}/${candidateMirrors.length})...`
      );
    }

    // Only trip circuit breaker if ALL candidate mirrors were challenged/failed in this request cycle
    if (challengedMirrorsCount >= candidateMirrors.length) {
      this.logger.warn(
        `[Egydead] All ${candidateMirrors.length} candidate mirrors were challenged/failed for ${pathAndQuery}; tripping circuit breaker failure.`
      );
      this.recordChallengeFailure();
    }

    if (lastResp) {
      return lastResp;
    }
    throw lastError || new Error(`All candidate Egydead mirrors failed for ${pathAndQuery}`);
  }

  getCatalogs(): ProviderCatalogDefinition[] {
    return [
      {
        id: 'movies',
        name: 'الأفلام (Movies)',
        genres: ['الكل', 'أفلام أجنبية', 'أفلام عربية', 'أفلام هندية', 'أفلام آسيوية', 'أفلام تركية', 'أفلام كرتون'],
      },
      {
        id: 'series',
        name: 'المسلسلات (Series)',
        genres: ['الكل', 'مسلسلات أجنبية', 'مسلسلات عربية', 'مسلسلات تركية', 'مسلسلات كورية', 'مسلسلات أنمي'],
      },
    ];
  }

  private fixUrl(url?: string): string {
    if (!url) return '';
    if (url.startsWith('//')) return `https:${url}`;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return `${this.mainUrl}${url.startsWith('/') ? '' : '/'}${url}`;
  }

  private extractNumericId(input: string): string {
    const match = input.match(/(\d+)/);
    return match ? match[1] : input.replace(/[^a-zA-Z0-9_-]/g, '');
  }

  private async fetchSearch(query: string): Promise<ProviderItem[]> {
    try {
      this.logger.debug(`Searching Egydead for query "${query}"`);
      const url = `/api/v1/search/${encodeURIComponent(query)}`;
      const resp = await this.requestWithRetry(url, {
        isApi: true,
        timeout: 7000,
        maxRetries: 1,
      });

      if (isCaptchaChallenge(resp.text, resp.status)) {
        this.logger.warn(`Egydead search returned captcha challenge for "${query}"`);
        return [];
      }

      if (resp.status === 200 && resp.text.startsWith('{')) {
        const data = JSON.parse(resp.text);
        const results: MtdbTitle[] = data.results || [];
        const items = results.map((item) => {
          const isSeries = Boolean(item.is_series || item.type === 'series' || item.name?.includes('مسلسل'));
          return {
            id: this.formatId(item.id.toString()),
            provider: this.name,
            type: isSeries ? ('series' as const) : ('movie' as const),
            title: item.name,
            poster: item.poster || undefined,
            year: item.year || (item.release_date ? new Date(item.release_date).getFullYear() : undefined),
            description: item.description || undefined,
            url: `${this.mainUrl}/titles/${item.id}`,
          };
        });
        return items;
      }

      // Cheerio HTML Fallback for legacy mirrors
      return this.searchHtmlFallback(resp);
    } catch (e) {
      this.logger.debug(`Egydead search error: ${(e as Error).message}`);
      return [];
    }
  }

  async searchInternal(query: string): Promise<ProviderItem[]> {
    const cacheKey = `egydead:search:${query.toLowerCase()}`;
    if (this.isCooldownActive()) {
      const cached = globalCache.get<ProviderItem[]>(cacheKey, true);
      if (cached) return cached;
      const remainingMin = Math.ceil(this.getCooldownRemainingMs() / 60000);
      this.logger.debug(`Egydead in Cloudflare cooldown (resuming in ${remainingMin}m); skipping search for "${query}".`);
      return [];
    }

    return globalCache.getOrRevalidate<ProviderItem[]>(
      cacheKey,
      async () => {
        try {
          const items = await this.fetchSearch(query);
          if (items.length === 0) {
            const stale = globalCache.get<ProviderItem[]>(cacheKey, true);
            if (stale && stale.length > 0) return stale;
          }
          return items;
        } catch (err) {
          const stale = globalCache.get<ProviderItem[]>(cacheKey, true);
          if (stale && stale.length > 0) return stale;
          throw err;
        }
      },
      {
        ttlSeconds: 600, // 10m fresh
        staleTtlSeconds: 1200, // 20m stale window
        onError: (err) => {
          this.logger.debug(
            `Background revalidation failed for search "${query}": ${(err as Error).message}`
          );
        },
      }
    );
  }

  private async fetchCatalog(catalogId: string, page: number = 1, genre?: string): Promise<ProviderItem[]> {
    try {
      const isSeries = catalogId === 'series';
      const channelSlug = isSeries ? 'series' : 'movies';
      this.logger.debug(`Fetching Egydead catalog "${catalogId}" page ${page}`);

      const url = `/api/v1/channel/${channelSlug}?page=${page}`;
      const resp = await this.requestWithRetry(url, {
        isApi: true,
        timeout: 8000,
        maxRetries: 1,
      });

      if (isCaptchaChallenge(resp.text, resp.status)) {
        this.logger.warn(`Egydead catalog "${catalogId}" page ${page} returned Cloudflare challenge`);
        return [];
      }

      if (resp.status === 200 && resp.text && resp.text.trim().startsWith('{')) {
        const data = JSON.parse(resp.text);
        const list: MtdbTitle[] = data.channel?.content?.data || data.channel?.content || [];

        let filtered = list;
        if (genre && genre !== 'الكل') {
          filtered = list.filter((item) => {
            const title = item.name || '';
            if (genre === 'أفلام كرتون' || genre === 'مسلسلات أنمي') {
              return title.includes('كرتون') || title.includes('أنمي') || title.includes('انمي');
            }
            if (genre === 'أفلام تركية' || genre === 'مسلسلات تركية') {
              return title.includes('تركي') || title.includes('تركية');
            }
            if (genre === 'أفلام عربية' || genre === 'مسلسلات عربية') {
              return title.includes('عربي') || title.includes('مصرية');
            }
            if (genre === 'أفلام هندية') {
              return title.includes('هندي');
            }
            if (genre === 'أفلام آسيوية' || genre === 'مسلسلات كورية') {
              return title.includes('كوري') || title.includes('آسيوي') || title.includes('ياباني');
            }
            return true;
          });
        }

        const items = filtered.map((item) => {
          const itemIsSeries = Boolean(item.is_series || item.type === 'series' || isSeries);
          return {
            id: this.formatId(item.id.toString()),
            provider: this.name,
            type: itemIsSeries ? ('series' as const) : ('movie' as const),
            title: item.name,
            poster: item.poster || undefined,
            year: item.year || (item.release_date ? new Date(item.release_date).getFullYear() : undefined),
            description: item.description || undefined,
            url: `${this.mainUrl}/titles/${item.id}`,
          };
        });

        return items;
      }

      // Cheerio HTML Fallback for legacy mirrors
      return this.catalogHtmlFallback(resp, isSeries);
    } catch (e) {
      const err = e as Error;
      this.logger.warn(
        `Egydead getCatalog error: ${err.name} - ${err.message}${err.stack ? `\n${err.stack}` : ''}`
      );
      return [];
    }
  }

  async getCatalogInternal(catalogId: string, page: number = 1, genre?: string): Promise<ProviderItem[]> {
    const cacheKey = `egydead:catalog:${catalogId}:${page}:${genre || ''}`;

    if (this.isCooldownActive()) {
      const cached = globalCache.get<ProviderItem[]>(cacheKey, true);
      if (cached && cached.length > 0) {
        this.logger.debug(`Egydead serving ${cached.length} stale cached items while in Cloudflare cooldown`);
        return cached;
      }
      const remainingMin = Math.ceil(this.getCooldownRemainingMs() / 60000);
      this.logger.debug(
        `Egydead in Cloudflare cooldown (resuming in ${remainingMin}m); skipping outbound request to prevent log spam and IP penalty.`
      );
      return [];
    }

    return globalCache.getOrRevalidate<ProviderItem[]>(
      cacheKey,
      async () => {
        try {
          const items = await this.fetchCatalog(catalogId, page, genre);
          if (items.length === 0) {
            const stale = globalCache.get<ProviderItem[]>(cacheKey, true);
            if (stale && stale.length > 0) return stale;
          }
          return items;
        } catch (err) {
          const stale = globalCache.get<ProviderItem[]>(cacheKey, true);
          if (stale && stale.length > 0) return stale;
          throw err;
        }
      },
      {
        ttlSeconds: 1800, // 30m fresh
        staleTtlSeconds: 1800, // 30m stale window (bounded 60m staleness ceiling)
        onError: (err) => {
          this.logger.debug(
            `Background revalidation failed for catalog "${catalogId}" page ${page}: ${(err as Error).message}`
          );
        },
      }
    );
  }

  private async fetchMeta(contentId: string, type: StremioContentType | string): Promise<ProviderDetail | null> {
    const titleId = this.extractNumericId(contentId);
    this.logger.debug(`Fetching Egydead metadata for title ${titleId} (original: ${contentId})`);

    try {
      const url = `/api/v1/titles/${titleId}?loader=titlePage`;
      const resp = await this.requestWithRetry(url, {
        isApi: true,
        timeout: 8000,
        maxRetries: 1,
      });

      if (isCaptchaChallenge(resp.text, resp.status)) {
        this.logger.warn(`Egydead meta returned Cloudflare challenge for ID ${titleId}`);
        return null;
      }

      if (resp.status === 200 && resp.text.startsWith('{')) {
        const data = JSON.parse(resp.text);
        const title: MtdbTitle = data.title;
        if (!title) return null;

        const isSeries = Boolean(title.is_series || title.type === 'series' || type === 'series');
        const episodes: ProviderEpisode[] = [];

        if (isSeries) {
          const seasons: MtdbSeason[] = data.seasons?.data || [{ id: 1, number: 1 }];
          for (const season of seasons) {
            try {
              const epResp = await this.requestWithRetry(
                `/api/v1/titles/${titleId}/seasons/${season.number}`,
                {
                  isApi: true,
                  timeout: 6000,
                  maxRetries: 1,
                }
              );
              if (epResp.status === 200 && epResp.text.startsWith('{')) {
                const epJson = JSON.parse(epResp.text);
                const epList: MtdbEpisode[] = epJson.episodes?.data || epJson.episodes || [];
                for (const ep of epList) {
                  episodes.push({
                    id: this.formatId(`${titleId}:${season.number}:${ep.episode_number}:${ep.id}`),
                    title: ep.name || `الحلقة ${ep.episode_number}`,
                    season: ep.season_number || season.number,
                    episode: ep.episode_number || 1,
                    url: `${this.mainUrl}/titles/${titleId}/episodes/${ep.id}`,
                    poster: ep.poster || title.poster,
                  });
                }
              }
            } catch (err) {
              this.logger.debug(`Error fetching season ${season.number} for ${titleId}: ${(err as Error).message}`);
            }
          }
        }

        const detail: ProviderDetail = {
          id: this.formatId(titleId),
          provider: this.name,
          type: isSeries ? 'series' : 'movie',
          title: title.name,
          poster: title.poster || undefined,
          background: title.backdrop || undefined,
          description: title.description || undefined,
          year: title.year || (title.release_date ? new Date(title.release_date).getFullYear() : undefined),
          url: `${this.mainUrl}/titles/${titleId}`,
          episodes: episodes.length > 0 ? episodes : undefined,
        };

        return detail;
      }

      // Legacy HTML Fallback
      return this.metaHtmlFallback(contentId, type);
    } catch (e) {
      this.logger.debug(`Egydead getMeta error: ${(e as Error).message}`);
      return null;
    }
  }

  async getMetaInternal(contentId: string, type: StremioContentType | string): Promise<ProviderDetail | null> {
    const titleId = this.extractNumericId(contentId);
    const cacheKey = `egydead:meta:${titleId}`;

    if (this.isCooldownActive()) {
      const cached = globalCache.get<ProviderDetail>(cacheKey, true);
      if (cached) return cached;
      this.logger.debug(`Egydead in Cloudflare cooldown; skipping meta fetch for ID ${titleId}`);
      return null;
    }

    return globalCache.getOrRevalidate<ProviderDetail | null>(
      cacheKey,
      async () => {
        try {
          const meta = await this.fetchMeta(contentId, type);
          if (!meta) {
            const stale = globalCache.get<ProviderDetail>(cacheKey, true);
            if (stale) return stale;
          }
          return meta;
        } catch (err) {
          const stale = globalCache.get<ProviderDetail>(cacheKey, true);
          if (stale) return stale;
          throw err;
        }
      },
      {
        ttlSeconds: 3600, // 60m fresh
        staleTtlSeconds: 1800, // 30m stale window (bounded 90m staleness ceiling)
        onError: (err) => {
          this.logger.debug(
            `Background revalidation failed for metadata "${contentId}": ${(err as Error).message}`
          );
        },
      }
    );
  }

  async getStreamsInternal(contentId: string, _type: StremioContentType | string, episodeId?: string): Promise<ResolvedStream[]> {
    if (this.isCooldownActive()) {
      const remainingMin = Math.ceil(this.getCooldownRemainingMs() / 60000);
      this.logger.debug(
        `Egydead in Cloudflare cooldown (resuming in ${remainingMin}m); skipping stream resolution for ${contentId}.`
      );
      return [];
    }

    const streams: ResolvedStream[] = [];
    const titleId = this.extractNumericId(contentId);
    this.logger.debug(`Resolving Egydead streams for title ${titleId}, episodeId: ${episodeId || 'none'}`);

    try {
      const serverEmbedUrls: { name: string; src: string }[] = [];

      if (episodeId) {
        // Episode stream resolution strictly scoped to requested episode
        const cleanEpId = episodeId.replace(/^egydead:/, '');
        const epParts = cleanEpId.split(':');
        let seasonNum: number | undefined;
        let epNum: number | undefined;
        let targetEpId: string | undefined;
        let primaryVideoId: number | string | undefined;

        this.logger.debug(
          `[Egydead] Episode stream request: rawEpisodeId="${episodeId}", parts=[${epParts.join(', ')}]`
        );

        if (epParts.length >= 4) {
          // Format: titleId:seasonNum:epNum:epId
          seasonNum = Number(epParts[1]);
          epNum = Number(epParts[2]);
          targetEpId = epParts[3];
        } else if (epParts.length === 3) {
          // Format: titleId:seasonNum:epNum OR seasonNum:epNum:epId
          if (Number(epParts[1]) < 100 && Number(epParts[2]) < 500) {
            seasonNum = Number(epParts[1]);
            epNum = Number(epParts[2]);
          } else {
            seasonNum = Number(epParts[0]);
            epNum = Number(epParts[1]);
            targetEpId = epParts[2];
          }
        } else if (epParts.length === 2) {
          // Format: titleId:epId OR seasonNum:epNum
          if (Number(epParts[0]) < 50 && Number(epParts[1]) < 500) {
            seasonNum = Number(epParts[0]);
            epNum = Number(epParts[1]);
          } else {
            targetEpId = epParts[1];
          }
        } else if (epParts.length === 1) {
          targetEpId = epParts[0];
        }

        // If season and episode numbers are missing, look up via cached metadata or season endpoints
        if ((!seasonNum || !epNum) && targetEpId) {
          const cachedMeta = globalCache.get<ProviderDetail>(`egydead:meta:${titleId}`);
          if (cachedMeta?.episodes) {
            const found = cachedMeta.episodes.find(
              (e) =>
                e.id === episodeId ||
                e.id === `egydead:${cleanEpId}` ||
                e.id.endsWith(`:${targetEpId}`) ||
                e.url.endsWith(`/${targetEpId}`)
            );
            if (found) {
              seasonNum = found.season;
              epNum = found.episode;
            }
          }

          if (!seasonNum || !epNum) {
            try {
              const sResp = await this.requestWithRetry(
                `${this.mainUrl}/api/v1/titles/${titleId}/seasons/1`,
                { isApi: true, timeout: 6000, maxRetries: 1 }
              );
              if (sResp.status === 200 && sResp.text.startsWith('{')) {
                const sJson = JSON.parse(sResp.text);
                const matched = (sJson.episodes?.data || []).find(
                  (e: any) => String(e.id) === String(targetEpId)
                );
                if (matched) {
                  seasonNum = matched.season_number || 1;
                  epNum = matched.episode_number;
                  if (matched.primary_video?.id) {
                    primaryVideoId = matched.primary_video.id;
                  }
                }
              }
            } catch (err) {
              this.logger.debug(`Season lookup error for title ${titleId}: ${(err as Error).message}`);
            }
          }
        }

        this.logger.debug(
          `[Egydead] Episode scoped parameters: titleId=${titleId}, season=${seasonNum || 'unknown'}, episode=${epNum || 'unknown'}, targetEpId=${targetEpId || 'none'}`
        );

        // 1. Fetch exact episode page: /api/v1/titles/:titleId/seasons/:seasonNum/episodes/:epNum?loader=episodePage
        if (seasonNum && epNum) {
          try {
            const epPageUrl = `${this.mainUrl}/api/v1/titles/${titleId}/seasons/${seasonNum}/episodes/${epNum}?loader=episodePage`;
            const epPageResp = await this.requestWithRetry(epPageUrl, {
              isApi: true,
              timeout: 7000,
              maxRetries: 1,
            });

            if (epPageResp.status === 200 && epPageResp.text.startsWith('{')) {
              const data = JSON.parse(epPageResp.text);
              const epVideos: MtdbVideo[] = data.episode?.videos || [];
              for (const v of epVideos) {
                // Confirm video belongs to this episode and title without leaking other episodes
                if (
                  v.src &&
                  (!targetEpId || !v.episode_id || String(v.episode_id) === String(targetEpId)) &&
                  !serverEmbedUrls.some((s) => s.src === v.src)
                ) {
                  serverEmbedUrls.push({ name: v.name || 'سيرفر الحلقات', src: v.src });
                }
              }
            }
          } catch (err) {
            this.logger.debug(`Episode page lookup error: ${(err as Error).message}`);
          }
        }

        // 2. Fallback: Lookup video directly by primaryVideoId or targetEpId /api/v1/videos/:id
        const fallbackVideoId = primaryVideoId || (targetEpId && /^\d+$/.test(targetEpId) ? targetEpId : undefined);
        if (serverEmbedUrls.length === 0 && fallbackVideoId) {
          try {
            const directVideoResp = await this.requestWithRetry(
              `${this.mainUrl}/api/v1/videos/${fallbackVideoId}`,
              { isApi: true, timeout: 6000, maxRetries: 1 }
            );
            if (directVideoResp.status === 200 && directVideoResp.text.startsWith('{')) {
              const data = JSON.parse(directVideoResp.text);
              if (data.video?.src) {
                serverEmbedUrls.push({ name: data.video.name || 'سيرفر أساسي', src: data.video.src });
              }
            }
          } catch (err) {
            this.logger.debug(`Video endpoint lookup error for ID ${fallbackVideoId}: ${(err as Error).message}`);
          }
        }
      } else {
        // Movie stream resolution
        const titleResp = await this.requestWithRetry(`${this.mainUrl}/api/v1/titles/${titleId}?loader=titlePage`, {
          isApi: true,
          timeout: 7000,
          maxRetries: 1,
        });

        if (titleResp.status === 200 && titleResp.text.startsWith('{')) {
          const data = JSON.parse(titleResp.text);
          const videos: MtdbVideo[] = data.title?.videos || [];
          for (const v of videos) {
            if (v.src && !serverEmbedUrls.some((s) => s.src === v.src)) {
              serverEmbedUrls.push({ name: v.name || 'السيرفر الأول', src: v.src });
            }
          }
        }
      }

      // Extract streams from gathered embed URLs with dual playback mode (Proxy + Direct)
      for (const embed of serverEmbedUrls) {
        try {
          const extracted = await extractStreams(embed.src, `${this.mainUrl}/`);
          for (const s of extracted) {
            const baseServerName = `Egydead - ${embed.name} (${s.name})`;
            const streamProxyUrl = `/api/stream-proxy?url=${encodeURIComponent(s.url)}&referer=${encodeURIComponent(embed.src)}&userAgent=${encodeURIComponent(DEFAULT_USER_AGENT)}`;
            const proxyHeaders = {
              Referer: embed.src,
              'User-Agent': DEFAULT_USER_AGENT,
            };

            // 1. Proxied variant for browser/web playback (unchanged delivery)
            streams.push({
              name: `${baseServerName} (Proxy — Browser)`,
              title: `${baseServerName} [${s.quality || 'Auto'}] (Proxy — Browser)\nRe-3arabi High-Speed Stream`,
              quality: s.quality || 'Auto',
              url: streamProxyUrl,
              isM3u8: s.isM3u8 ?? true,
              headers: proxyHeaders,
              behaviorHints: {
                notWebReady: false,
                proxyHeaders: {
                  request: proxyHeaders,
                },
              },
            });

            // 2. Direct variant for native players (VLC, MX Player, ExoPlayer)
            streams.push({
              name: `${baseServerName} (Direct — VLC/External Player)`,
              title: `${baseServerName} [${s.quality || 'Auto'}] (Direct — VLC/External Player)\nRe-3arabi Direct Stream`,
              quality: s.quality || 'Auto',
              url: s.url,
              isM3u8: s.isM3u8 ?? true,
              headers: proxyHeaders,
              behaviorHints: {
                notWebReady: false,
                proxyHeaders: {
                  request: proxyHeaders,
                },
              },
            });
          }
        } catch (err) {
          this.logger.debug(`Stream extraction failed for ${embed.src}: ${(err as Error).message}`);
        }
      }

      if (streams.length > 0) {
        this.logger.info(`Egydead resolved ${streams.length} stream variants for title ${titleId}`);
        return streams;
      }

      // If MTDb yielded no streams, fallback to classic watch-page flow
      const fallbackStreams = await this.streamsHtmlFallback(contentId, episodeId);
      for (const fs of fallbackStreams) {
        // Apply dual mode to fallback streams as well
        const baseName = fs.name;
        const proxyUrl = `/api/stream-proxy?url=${encodeURIComponent(fs.url)}&referer=${encodeURIComponent(this.mainUrl)}&userAgent=${encodeURIComponent(DEFAULT_USER_AGENT)}`;
        const headers = fs.headers || { Referer: this.mainUrl, 'User-Agent': DEFAULT_USER_AGENT };

        streams.push({
          name: `${baseName} (Proxy — Browser)`,
          title: `${baseName} [${fs.quality || 'Auto'}] (Proxy — Browser)\nRe-3arabi High-Speed Stream`,
          quality: fs.quality || 'Auto',
          url: proxyUrl,
          isM3u8: fs.isM3u8 ?? true,
          headers,
          behaviorHints: {
            notWebReady: false,
            proxyHeaders: { request: headers },
          },
        });

        streams.push({
          name: `${baseName} (Direct — VLC/External Player)`,
          title: `${baseName} [${fs.quality || 'Auto'}] (Direct — VLC/External Player)\nRe-3arabi Direct Stream`,
          quality: fs.quality || 'Auto',
          url: fs.url,
          isM3u8: fs.isM3u8 ?? true,
          headers,
          behaviorHints: {
            notWebReady: false,
            proxyHeaders: { request: headers },
          },
        });
      }
      return streams;
    } catch (e) {
      this.logger.warn(`Egydead stream resolution encountered error: ${(e as Error).message}`);
      return [];
    }
  }

  // --- HTML FALLBACKS FOR LEGACY / ALTERNATE MIRRORS ---

  private searchHtmlFallback(resp: any): ProviderItem[] {
    const items: ProviderItem[] = [];
    const seenIds = new Set<string>();

    resp.$('div.MovieBlock, div.PostBlock, div.moviesList div.item').each((_: number, el: any) => {
      const a = resp.$(el).find('a').first();
      const title = resp.$(el).find('.Title, h2, h3').text().trim() || a.attr('title') || '';
      const href = a.attr('href');
      if (!title || !href) return;

      const cleanPath = href.replace(/^https?:\/\/[^/]+/, '');
      const id = this.formatId(cleanPath);
      if (seenIds.has(id)) return;
      seenIds.add(id);

      const poster = this.fixUrl(resp.$(el).find('img').attr('data-src') || resp.$(el).find('img').attr('src'));
      const isSeries = href.includes('/series/') || title.includes('مسلسل');

      items.push({
        id,
        provider: this.name,
        type: isSeries ? 'series' : 'movie',
        title,
        poster,
        url: this.fixUrl(href),
      });
    });

    return items;
  }

  private catalogHtmlFallback(resp: any, isSeries: boolean): ProviderItem[] {
    const items: ProviderItem[] = [];
    const seenIds = new Set<string>();

    resp.$('div.MovieBlock, div.PostBlock, div.moviesList div.item').each((_: number, el: any) => {
      const a = resp.$(el).find('a').first();
      const title = resp.$(el).find('.Title, h2, h3').text().trim() || a.attr('title') || '';
      const href = a.attr('href');
      if (!title || !href) return;

      const cleanPath = href.replace(/^https?:\/\/[^/]+/, '');
      const id = this.formatId(cleanPath);
      if (seenIds.has(id)) return;
      seenIds.add(id);

      const poster = this.fixUrl(resp.$(el).find('img').attr('data-src') || resp.$(el).find('img').attr('src'));

      items.push({
        id,
        provider: this.name,
        type: isSeries ? 'series' : 'movie',
        title,
        poster,
        url: this.fixUrl(href),
      });
    });

    return items;
  }

  private async metaHtmlFallback(contentId: string, type: StremioContentType | string): Promise<ProviderDetail | null> {
    try {
      const fullUrl = this.fixUrl(contentId);
      const resp = await http.get(fullUrl, {
        headers: { 'User-Agent': MOBILE_USER_AGENT },
      });

      const title = resp.$('h1.Title').text().trim() || resp.$('meta[property="og:title"]').attr('content') || 'Egydead Title';
      const poster = this.fixUrl(resp.$('.Poster img').attr('data-src') || resp.$('.Poster img').attr('src'));
      const description = resp.$('.Story p, .desc').text().trim();

      const episodes: ProviderEpisode[] = [];
      const isSeries = type === 'series' || fullUrl.includes('/series/');
      if (isSeries) {
        resp.$('.episodes-list a, .seasons-list a').each((idx: number, el: any) => {
          const epHref = resp.$(el).attr('href');
          const epTitle = resp.$(el).text().trim() || `حلقة ${idx + 1}`;
          if (!epHref) return;

          const epNumMatch = epTitle.match(/(\d+)/);
          const epNum = epNumMatch ? parseInt(epNumMatch[1], 10) : idx + 1;

          episodes.push({
            id: this.formatId(epHref.replace(this.mainUrl, '')),
            title: epTitle,
            season: 1,
            episode: epNum,
            url: this.fixUrl(epHref),
            poster,
          });
        });
      }

      return {
        id: this.formatId(contentId),
        provider: this.name,
        type: episodes.length > 0 ? 'series' : 'movie',
        title,
        poster,
        description,
        url: fullUrl,
        episodes: episodes.length > 0 ? episodes : undefined,
      };
    } catch {
      return null;
    }
  }

  private async streamsHtmlFallback(contentId: string, episodeId?: string): Promise<ResolvedStream[]> {
    const targetPath = episodeId || contentId;
    const fullUrl = this.fixUrl(targetPath);
    const streams: ResolvedStream[] = [];

    try {
      const watchUrl = `${fullUrl}?view=watch`;
      const resp = await http.post(watchUrl, {
        form: { View: '1' },
        headers: {
          'User-Agent': MOBILE_USER_AGENT,
          Referer: fullUrl,
          'X-Requested-With': 'XMLHttpRequest',
        },
      });

      const serverLinks: string[] = [];
      resp.$('ul.serversList li [data-link], button[data-link]').each((_: number, el: any) => {
        const link = resp.$(el).attr('data-link');
        if (link) serverLinks.push(this.fixUrl(link));
      });

      resp.$('ul.donwload-servers-list li a.ser-link').each((_: number, el: any) => {
        const link = resp.$(el).attr('href');
        if (link) serverLinks.push(this.fixUrl(link));
      });

      for (const link of serverLinks) {
        const extracted = await extractStreams(link, watchUrl);
        streams.push(...extracted);
      }
    } catch (e) {
      this.logger.debug(`Egydead HTML fallback encountered: ${(e as Error).message}`);
    }

    return streams;
  }
}