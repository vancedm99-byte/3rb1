import { BaseProvider } from '../base.js';
import { ProviderCatalogDefinition, ProviderDetail, ProviderEpisode, ProviderItem, ResolvedStream } from '../../types/provider.js';
import { StremioContentType } from '../../types/stremio.js';
import { http, DEFAULT_USER_AGENT, MOBILE_USER_AGENT } from '../../utils/http.js';
import { extractStreams } from '../../extractors/index.js';
import { isCaptchaChallenge } from '../../utils/captcha.js';

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

  constructor() {
    super();
    this.initLogger();
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
    try {
      this.logger.debug(`Searching Egydead for query "${query}"`);
      const url = `${this.mainUrl}/api/v1/search/${encodeURIComponent(query)}`;
      const resp = await http.get(url, {
        headers: {
          'User-Agent': DEFAULT_USER_AGENT,
          'Accept': 'application/json',
          'Referer': `${this.mainUrl}/`,
        },
        timeout: 7000,
      });

      if (isCaptchaChallenge(resp.text, resp.status)) {
        this.logger.warn(`Egydead search returned captcha challenge for "${query}"`);
        return [];
      }

      if (resp.status === 200 && resp.text.startsWith('{')) {
        const data = JSON.parse(resp.text);
        const results: MtdbTitle[] = data.results || [];
        return results.map((item) => {
          const isSeries = Boolean(item.is_series || item.type === 'series' || item.name?.includes('مسلسل'));
          return {
            id: this.formatId(item.id.toString()),
            provider: this.name,
            type: isSeries ? 'series' : 'movie',
            title: item.name,
            poster: item.poster || undefined,
            year: item.year || (item.release_date ? new Date(item.release_date).getFullYear() : undefined),
            description: item.description || undefined,
            url: `${this.mainUrl}/titles/${item.id}`,
          };
        });
      }

      // Cheerio HTML Fallback for legacy mirrors
      return this.searchHtmlFallback(resp);
    } catch (e) {
      this.logger.debug(`Egydead search error: ${(e as Error).message}`);
      return [];
    }
  }

  async getCatalogInternal(catalogId: string, page: number = 1, genre?: string): Promise<ProviderItem[]> {
    try {
      const isSeries = catalogId === 'series';
      const channelSlug = isSeries ? 'series' : 'movies';
      this.logger.debug(`Fetching Egydead catalog "${catalogId}" page ${page}`);

      const url = `${this.mainUrl}/api/v1/channel/${channelSlug}?page=${page}`;
      const resp = await http.get(url, {
        headers: {
          'User-Agent': DEFAULT_USER_AGENT,
          'Accept': 'application/json',
          'Referer': `${this.mainUrl}/`,
        },
        timeout: 8000,
      });

      if (isCaptchaChallenge(resp.text, resp.status)) {
        this.logger.warn(`Egydead catalog "${catalogId}" page ${page} returned Cloudflare challenge`);
        return [];
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

        return filtered.map((item) => {
          const itemIsSeries = Boolean(item.is_series || item.type === 'series' || isSeries);
          return {
            id: this.formatId(item.id.toString()),
            provider: this.name,
            type: itemIsSeries ? 'series' : 'movie',
            title: item.name,
            poster: item.poster || undefined,
            year: item.year || (item.release_date ? new Date(item.release_date).getFullYear() : undefined),
            description: item.description || undefined,
            url: `${this.mainUrl}/titles/${item.id}`,
          };
        });
      }

      // Cheerio HTML Fallback for legacy mirrors
      return this.catalogHtmlFallback(resp, isSeries);
    } catch (e) {
      this.logger.debug(`Egydead getCatalog error: ${(e as Error).message}`);
      return [];
    }
  }

  async getMetaInternal(contentId: string, type: StremioContentType | string): Promise<ProviderDetail | null> {
    const titleId = this.extractNumericId(contentId);
    this.logger.debug(`Fetching Egydead metadata for title ${titleId} (original: ${contentId})`);

    try {
      const url = `${this.mainUrl}/api/v1/titles/${titleId}?loader=titlePage`;
      const resp = await http.get(url, {
        headers: {
          'User-Agent': DEFAULT_USER_AGENT,
          'Accept': 'application/json',
          'Referer': `${this.mainUrl}/`,
        },
        timeout: 8000,
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
              const epResp = await http.get(`${this.mainUrl}/api/v1/titles/${titleId}/seasons/${season.number}`, {
                headers: {
                  'User-Agent': DEFAULT_USER_AGENT,
                  'Accept': 'application/json',
                  'Referer': `${this.mainUrl}/`,
                },
                timeout: 6000,
              });
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

        return {
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
      }

      // Legacy HTML Fallback
      return this.metaHtmlFallback(contentId, type);
    } catch (e) {
      this.logger.debug(`Egydead getMeta error: ${(e as Error).message}`);
      return null;
    }
  }

  async getStreamsInternal(contentId: string, _type: StremioContentType | string, episodeId?: string): Promise<ResolvedStream[]> {
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
          const epVideosResp = await http.get(`${this.mainUrl}/api/v1/videos?titleId=${titleId}&episodeId=${epId}`, {
            headers: {
              'User-Agent': DEFAULT_USER_AGENT,
              'Accept': 'application/json',
              'Referer': `${this.mainUrl}/`,
            },
            timeout: 6000,
          });
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
            const directVideoResp = await http.get(`${this.mainUrl}/api/v1/videos/${epId}`, {
              headers: {
                'User-Agent': DEFAULT_USER_AGENT,
                'Accept': 'application/json',
                'Referer': `${this.mainUrl}/`,
              },
              timeout: 6000,
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
        const titleResp = await http.get(`${this.mainUrl}/api/v1/titles/${titleId}?loader=titlePage`, {
          headers: {
            'User-Agent': DEFAULT_USER_AGENT,
            'Accept': 'application/json',
            'Referer': `${this.mainUrl}/`,
          },
          timeout: 7000,
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
