import { BaseProvider } from '../base.js';
import { ProviderCatalogDefinition, ProviderDetail, ProviderEpisode, ProviderItem, ResolvedStream } from '../../types/provider.js';
import { StremioContentType } from '../../types/stremio.js';
import { http, HttpResponse, DEFAULT_USER_AGENT, MOBILE_USER_AGENT } from '../../utils/http.js';
import { extractStreams } from '../../extractors/index.js';
import { isCaptchaChallenge } from '../../utils/captcha.js';
import { globalCache } from '../../utils/cache.js';

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

  // Mirror domains tracked for fallback
  mirrors: string[] = ['https://egydead.ca', 'https://tv10.egydead.live', 'https://egydead.beer'];

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

  private getBrowserHeaders(isApi: boolean = true): Record<string, string> {
    return {
      'User-Agent': DEFAULT_USER_AGENT,
      'Accept': isApi
        ? 'application/json, text/plain, */*'
        : 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
      'Referer': `${this.mainUrl}/`,
      'Origin': this.mainUrl,
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
    url: string,
    options: { isApi?: boolean; timeout?: number; maxRetries?: number } = {}
  ): Promise<HttpResponse<any>> {
    const isApi = options.isApi ?? true;
    const timeout = options.timeout ?? 8000;
    const maxRetries = options.maxRetries ?? 1;

    let lastResp: HttpResponse<any> | null = null;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      const headers = this.getBrowserHeaders(isApi);
      if (attempt > 1) {
        headers['Cache-Control'] = 'no-cache';
      }

      try {
        const resp = await http.get(url, { headers, timeout });
        lastResp = resp;

        if (!isCaptchaChallenge(resp.text, resp.status)) {
          this.recordSuccess();
          return resp;
        }

        if (attempt <= maxRetries) {
          this.logger.debug(
            `Egydead request to ${url} returned Cloudflare challenge (attempt ${attempt}/${maxRetries + 1}); retrying with 1.5s backoff...`
          );
          await new Promise((r) => setTimeout(r, 1500));
        }
      } catch (err) {
        this.logger.debug(`Egydead request error on attempt ${attempt} for ${url}: ${(err as Error).message}`);
        if (attempt > maxRetries) throw err;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }

    if (lastResp && isCaptchaChallenge(lastResp.text, lastResp.status)) {
      this.recordChallengeFailure();
    }

    return lastResp!;
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

  async searchInternal(query: string): Promise<ProviderItem[]> {
    const cacheKey = `egydead:search:${query.toLowerCase()}`;
    if (this.isCooldownActive()) {
      const cached = globalCache.get<ProviderItem[]>(cacheKey);
      if (cached) return cached;
      const remainingMin = Math.ceil(this.getCooldownRemainingMs() / 60000);
      this.logger.debug(`Egydead in Cloudflare cooldown (resuming in ${remainingMin}m); skipping search for "${query}".`);
      return [];
    }

    try {
      this.logger.debug(`Searching Egydead for query "${query}"`);
      const url = `${this.mainUrl}/api/v1/search/${encodeURIComponent(query)}`;
      const resp = await this.requestWithRetry(url, {
        isApi: true,
        timeout: 7000,
        maxRetries: 1,
      });

      if (isCaptchaChallenge(resp.text, resp.status)) {
        this.logger.warn(`Egydead search returned captcha challenge for "${query}"`);
        return globalCache.get<ProviderItem[]>(cacheKey) || [];
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
        if (items.length > 0) {
          globalCache.set(cacheKey, items, 600); // 10m cache
        }
        return items;
      }

      // Cheerio HTML Fallback for legacy mirrors
      return this.searchHtmlFallback(resp);
    } catch (e) {
      this.logger.debug(`Egydead search error: ${(e as Error).message}`);
      return globalCache.get<ProviderItem[]>(cacheKey) || [];
    }
  }

  async getCatalogInternal(catalogId: string, page: number = 1, genre?: string): Promise<ProviderItem[]> {
    const cacheKey = `egydead:catalog:${catalogId}:${page}:${genre || ''}`;

    if (this.isCooldownActive()) {
      const cached = globalCache.get<ProviderItem[]>(cacheKey);
      if (cached && cached.length > 0) {
        this.logger.debug(`Egydead serving ${cached.length} cached items while in Cloudflare cooldown`);
        return cached;
      }
      const remainingMin = Math.ceil(this.getCooldownRemainingMs() / 60000);
      this.logger.debug(
        `Egydead in Cloudflare cooldown (resuming in ${remainingMin}m); skipping outbound request to prevent log spam and IP penalty.`
      );
      return [];
    }

    try {
      const isSeries = catalogId === 'series';
      const channelSlug = isSeries ? 'series' : 'movies';
      this.logger.debug(`Fetching Egydead catalog "${catalogId}" page ${page}`);

      const url = `${this.mainUrl}/api/v1/channel/${channelSlug}?page=${page}`;
      const resp = await this.requestWithRetry(url, {
        isApi: true,
        timeout: 8000,
        maxRetries: 1,
      });

      if (isCaptchaChallenge(resp.text, resp.status)) {
        this.logger.warn(`Egydead catalog "${catalogId}" page ${page} returned Cloudflare challenge`);
        const cached = globalCache.get<ProviderItem[]>(cacheKey);
        return cached || [];
      }

      if (resp.status === 200 && resp.text.startsWith('{')) {
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

        if (items.length > 0) {
          globalCache.set(cacheKey, items, 1800); // 30m cache
        }
        return items;
      }

      // Cheerio HTML Fallback for legacy mirrors
      return this.catalogHtmlFallback(resp, isSeries);
    } catch (e) {
      this.logger.debug(`Egydead getCatalog error: ${(e as Error).message}`);
      const cached = globalCache.get<ProviderItem[]>(cacheKey);
      return cached || [];
    }
  }

  async getMetaInternal(contentId: string, type: StremioContentType | string): Promise<ProviderDetail | null> {
    const titleId = this.extractNumericId(contentId);
    const cacheKey = `egydead:meta:${titleId}`;

    if (this.isCooldownActive()) {
      const cached = globalCache.get<ProviderDetail>(cacheKey);
      if (cached) return cached;
      this.logger.debug(`Egydead in Cloudflare cooldown; skipping meta fetch for ID ${titleId}`);
      return null;
    }

    this.logger.debug(`Fetching Egydead metadata for title ${titleId} (original: ${contentId})`);

    try {
      const url = `${this.mainUrl}/api/v1/titles/${titleId}?loader=titlePage`;
      const resp = await this.requestWithRetry(url, {
        isApi: true,
        timeout: 8000,
        maxRetries: 1,
      });

      if (isCaptchaChallenge(resp.text, resp.status)) {
        this.logger.warn(`Egydead meta returned Cloudflare challenge for ID ${titleId}`);
        return globalCache.get<ProviderDetail>(cacheKey);
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
                `${this.mainUrl}/api/v1/titles/${titleId}/seasons/${season.number}`,
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
                    id: this.formatId(`${titleId}:${ep.id}`),
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

        globalCache.set(cacheKey, detail, 3600); // 1h cache
        return detail;
      }

      // Legacy HTML Fallback
      return this.metaHtmlFallback(contentId, type);
    } catch (e) {
      this.logger.debug(`Egydead getMeta error: ${(e as Error).message}`);
      return globalCache.get<ProviderDetail>(cacheKey);
    }
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
        // Episode stream resolution
        const epId = this.extractNumericId(episodeId.split(':').pop() || episodeId);

        // 1. Check /api/v1/videos?titleId=X&episodeId=Y
        try {
          const epVideosResp = await this.requestWithRetry(
            `${this.mainUrl}/api/v1/videos?titleId=${titleId}&episodeId=${epId}`,
            {
              isApi: true,
              timeout: 6000,
              maxRetries: 1,
            }
          );
          if (epVideosResp.status === 200 && epVideosResp.text.startsWith('{')) {
            const data = JSON.parse(epVideosResp.text);
            const videos: MtdbVideo[] = data.pagination?.data || [];
            for (const v of videos) {
              if (v.src && !serverEmbedUrls.some((s) => s.src === v.src)) {
                serverEmbedUrls.push({ name: v.name || 'سيرفر الحلقات', src: v.src });
              }
            }
          }
        } catch (err) {
          this.logger.debug(`Direct episode video lookup error: ${(err as Error).message}`);
        }

        // 2. Fallback: Lookup video directly by ID /api/v1/videos/:id
        if (serverEmbedUrls.length === 0 && epId) {
          try {
            const directVideoResp = await this.requestWithRetry(`${this.mainUrl}/api/v1/videos/${epId}`, {
              isApi: true,
              timeout: 6000,
              maxRetries: 1,
            });
            if (directVideoResp.status === 200 && directVideoResp.text.startsWith('{')) {
              const data = JSON.parse(directVideoResp.text);
              if (data.video?.src) {
                serverEmbedUrls.push({ name: data.video.name || 'سيرفر أساسي', src: data.video.src });
              }
            }
          } catch (err) {
            this.logger.debug(`Video endpoint lookup error: ${(err as Error).message}`);
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

      // Extract streams from gathered embed URLs
      for (const embed of serverEmbedUrls) {
        try {
          const extracted = await extractStreams(embed.src, `${this.mainUrl}/`);
          for (const s of extracted) {
            // Egydead upstream hosts (such as egybestvid.com) protect streams with signed tokens
            // that are cryptographically bound to the server's public IP and User-Agent.
            // Direct playback requests from external clients/players result in HTTP 403 Forbidden.
            // Route through /api/stream-proxy and forward Referer & User-Agent headers.
            const streamProxyUrl = `/api/stream-proxy?url=${encodeURIComponent(s.url)}&referer=${encodeURIComponent(embed.src)}&userAgent=${encodeURIComponent(DEFAULT_USER_AGENT)}`;
            streams.push({
              name: `Egydead - ${embed.name} (${s.name})`,
              quality: s.quality || 'Auto',
              url: streamProxyUrl,
              isM3u8: s.isM3u8 ?? true,
              headers: {
                Referer: embed.src,
                'User-Agent': DEFAULT_USER_AGENT,
              },
            });
          }
        } catch (err) {
          this.logger.debug(`Stream extraction failed for ${embed.src}: ${(err as Error).message}`);
        }
      }

      if (streams.length > 0) {
        this.logger.info(`Egydead resolved ${streams.length} streams for title ${titleId}`);
        return streams;
      }

      // If MTDb yielded no streams, fallback to classic watch-page flow
      return this.streamsHtmlFallback(contentId, episodeId);
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
