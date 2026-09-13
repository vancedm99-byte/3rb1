import vm from 'node:vm';
import { BaseProvider } from '../base.js';
import { ProviderCatalogDefinition, ProviderDetail, ProviderEpisode, ProviderItem, ResolvedStream } from '../../types/provider.js';
import { StremioContentType } from '../../types/stremio.js';
import { http, MOBILE_USER_AGENT } from '../../utils/http.js';
import { extractStreams } from '../../extractors/index.js';

export class FaselhdProvider extends BaseProvider {
  id = 'faselhd';
  name = 'FaselHD (فاصل إعلاني)';
  lang = 'ar';
  mainUrl = 'https://www.faselhd.pro';
  supportedTypes: StremioContentType[] = ['movie', 'series', 'anime'];

  constructor() {
    super();
    this.initLogger();
  }

  getCatalogs(): ProviderCatalogDefinition[] {
    return [
      {
        id: 'movies',
        name: 'الأفلام (Movies)',
        genres: ['الكل', 'الأكشن', 'الدراما', 'الكوميديا', 'الرعب', 'خيال علمي', 'مغامرات', 'عربي', 'أجنبي', 'هندي'],
      },
      {
        id: 'series',
        name: 'المسلسلات (Series)',
        genres: ['الكل', 'مسلسلات أجنبية', 'مسلسلات تركية', 'مسلسلات عربية', 'مسلسلات كرتون'],
      },
      {
        id: 'anime',
        name: 'الأنمي (Anime)',
        genres: ['الكل', 'أفلام أنمي', 'مسلسلات أنمي'],
      },
    ];
  }

  private fixUrl(url?: string): string {
    if (!url) return '';
    if (url.startsWith('//')) return `https:${url}`;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return `${this.mainUrl}${url.startsWith('/') ? '' : '/'}${url}`;
  }

  async searchInternal(query: string): Promise<ProviderItem[]> {
    try {
      const url = `${this.mainUrl}/?s=${encodeURIComponent(query)}`;
      const resp = await http.get(url, {
        headers: { 'User-Agent': MOBILE_USER_AGENT },
        timeout: 6000,
      });

      const items: ProviderItem[] = [];
      const seenIds = new Set<string>();

      resp.$('div.postDiv').each((_, el) => {
        const a = resp.$(el).find('a');
        const title = resp.$(el).find('.h1, h1, .post-title').text().trim() || a.attr('title') || '';
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
    } catch {
      return [];
    }
  }

  async getCatalogInternal(catalogId: string, page: number = 1, genre?: string): Promise<ProviderItem[]> {
    try {
      let path = 'movies';
      let type: StremioContentType = 'movie';
      if (catalogId === 'anime') {
        path = 'anime';
        type = 'anime';
      } else if (catalogId === 'series') {
        path = 'series';
        type = 'series';
      }

      if (genre && genre !== 'الكل') {
        const genreMap: Record<string, string> = {
          'مسلسلات تركية': 'turkish-series',
          'مسلسلات عربية': 'arabic-series',
          'مسلسلات أجنبية': 'series',
          'مسلسلات كرتون': 'dubbed-series',
          'أفلام أنمي': 'anime-movies',
          'مسلسلات أنمي': 'anime',
          'عربي': 'arabic-movies',
          'هندي': 'hindi-movies',
          'الأكشن': 'movies_top_views',
        };
        if (genreMap[genre]) {
          path = genreMap[genre];
        }
      }

      const url = `${this.mainUrl}/${path}${page > 1 ? `/page/${page}` : ''}`;
      const resp = await http.get(url, { timeout: 6000 });

      const items: ProviderItem[] = [];
      const seenIds = new Set<string>();

      resp.$('div.postDiv').each((_, el) => {
        const a = resp.$(el).find('a');
        const title = resp.$(el).find('.h1, h1, .post-title').text().trim() || a.attr('title') || '';
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
          type,
          title,
          poster,
          url: this.fixUrl(href),
        });
      });

      return items;
    } catch {
      return [];
    }
  }

  async getMetaInternal(contentId: string, type: StremioContentType | string): Promise<ProviderDetail | null> {
    const fullUrl = this.fixUrl(contentId);
    const resp = await http.get(fullUrl);

    const title = resp.$('h1.title').text().trim() || resp.$('meta[property="og:title"]').attr('content') || 'FaselHD Title';
    const poster = this.fixUrl(resp.$('.posterImg img').attr('src') || resp.$('meta[property="og:image"]').attr('content'));
    const description = resp.$('.singleDesc p').text().trim();

    const episodes: ProviderEpisode[] = [];
    const isSeries = type === 'series' || fullUrl.includes('/series/');
    if (isSeries) {
      resp.$('#episodes div.epAll a, div.episodes-list a').each((idx, el) => {
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
      type: episodes.length > 0 ? 'series' : (type === 'anime' ? 'anime' : 'movie'),
      title,
      poster,
      description,
      url: fullUrl,
      episodes: episodes.length > 0 ? episodes : undefined,
    };
  }

  async getStreamsInternal(contentId: string, _type: StremioContentType | string, episodeId?: string): Promise<ResolvedStream[]> {
    const targetPath = episodeId || contentId;
    const fullUrl = this.fixUrl(targetPath);
    const resp = await http.get(fullUrl);

    const streams: ResolvedStream[] = [];

    // 1. Direct FaselHD player token extraction from iframe[name="player_iframe"] or data-src
    const playerIframe = resp.$('iframe[name="player_iframe"], iframe[data-src*="player"], iframe[src*="player"]');
    const playerUrl = playerIframe.attr('data-src') || playerIframe.attr('src');

    if (playerUrl) {
      try {
        const fullPlayerUrl = this.fixUrl(playerUrl);
        const playerRes = await http.get(fullPlayerUrl, { headers: { Referer: fullUrl } });

        const ctx = {
          window: {},
          document: { getElementById: () => ({}) },
          navigator: { userAgent: 'Mozilla/5.0' },
          jwplayer: () => ({
            setup: (cfg: any) => {
              if (cfg?.file) {
                streams.push({
                  name: 'FaselHD Main (HLS)',
                  quality: '1080p / 720p',
                  url: cfg.file,
                  isM3u8: cfg.file.includes('.m3u8'),
                  headers: { Referer: fullPlayerUrl },
                });
              }
              if (Array.isArray(cfg?.sources)) {
                for (const s of cfg.sources) {
                  if (s.file) {
                    streams.push({
                      name: `FaselHD ${s.label || 'Direct'}`,
                      quality: s.label || '1080p',
                      url: s.file,
                      isM3u8: s.file.includes('.m3u8'),
                      headers: { Referer: fullPlayerUrl },
                    });
                  }
                }
              }
            },
            on: () => {},
          }),
        };
        vm.createContext(ctx);
        const scripts = playerRes.$('script').map((_, s) => playerRes.$(s).text()).get();
        for (const sc of scripts) {
          if (sc.includes('jwplayer') || sc.includes('sources') || sc.includes('eval')) {
            try {
              vm.runInContext(sc, ctx, { timeout: 2000 });
            } catch {}
          }
        }
      } catch (err) {
        this.logger.debug(`Error resolving FaselHD player token: ${(err as Error).message}`);
      }
    }

    // 2. Check server buttons and alternative iframes
    const serverLinks: string[] = [];
    resp.$('#show-servers-list button, ul.serversList li button, .buttonsList button').each((_, btn) => {
      const dataHref = resp.$(btn).attr('data-href') || resp.$(btn).attr('onclick')?.match(/https?:\/\/[^'"]+/)?.[0];
      if (dataHref) serverLinks.push(this.fixUrl(dataHref));
    });

    for (const sUrl of serverLinks) {
      try {
        const extracted = await extractStreams(sUrl, fullUrl);
        streams.push(...extracted);
      } catch {}
    }

    return streams;
  }
}
