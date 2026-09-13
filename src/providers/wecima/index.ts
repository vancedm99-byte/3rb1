import { BaseProvider } from '../base.js';
import { ProviderCatalogDefinition, ProviderDetail, ProviderEpisode, ProviderItem, ResolvedStream } from '../../types/provider.js';
import { StremioContentType } from '../../types/stremio.js';
import { http, MOBILE_USER_AGENT } from '../../utils/http.js';
import { safeBase64Decode } from '../../utils/crypto.js';
import { extractStreams } from '../../extractors/index.js';

export class WecimaProvider extends BaseProvider {
  id = 'wecima';
  name = 'We Cima (وي سيما)';
  lang = 'ar';
  mainUrl = 'https://mycima.motorcycles';
  supportedTypes: StremioContentType[] = ['movie', 'series'];

  constructor() {
    super();
    this.initLogger();
  }

  getCatalogs(): ProviderCatalogDefinition[] {
    return [
      {
        id: 'movies',
        name: 'الأفلام (Movies)',
        genres: ['الكل', 'افلام عربي', 'افلام اجنبي', 'افلام اكشن', 'افلام كوميدي', 'افلام هندي', 'افلام تركي'],
      },
      {
        id: 'series',
        name: 'المسلسلات (Series)',
        genres: ['الكل', 'مسلسلات عربي', 'مسلسلات اجنبي', 'مسلسلات تركي', 'مسلسلات رمضان 2026', 'مسلسلات رمضان 2025'],
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
      const url = `${this.mainUrl}/search.php?keywords=${encodeURIComponent(query)}`;
      const resp = await http.get(url, { timeout: 6000 });

      const items: ProviderItem[] = [];
      const seenIds = new Set<string>();

      resp.$('a[href*="watch.php"]').each((_, a) => {
        const href = resp.$(a).attr('href');
        const title = resp.$(a).text().trim() || resp.$(a).attr('title') || '';
        if (!title || !href || title.length < 3) return;

        const cleanPath = href.replace(/^https?:\/\/[^/]+/, '');
        const id = this.formatId(cleanPath);
        if (seenIds.has(id)) return;
        seenIds.add(id);

        const poster = this.fixUrl(resp.$(a).find('img').attr('src'));
        const isSeries = href.includes('series') || title.includes('مسلسل');

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
      const isSeries = catalogId === 'series';
      let url = isSeries
        ? `${this.mainUrl}/episodes.php`
        : `${this.mainUrl}/movies.php`;

      if (genre && genre !== 'الكل') {
        const catMap: Record<string, string> = {
          'افلام عربي': 'aflam-a',
          'افلام اجنبي': 'aflam-ajnbe111',
          'افلام اكشن': 'aflam-akshn101',
          'افلام كوميدي': 'aflam-kw',
          'افلام هندي': 'aflam-hnde14',
          'افلام تركي': 'aflam-trke22',
          'مسلسلات عربي': 'mslslat-arbe122',
          'مسلسلات اجنبي': 'mslslat-ajnbe11',
          'مسلسلات تركي': 'mslslat-trke1',
          'مسلسلات رمضان 2026': 'Ramadan-series-2026',
          'مسلسلات رمضان 2025': 'mslslat-rmdan-25',
        };
        if (catMap[genre]) {
          url = `${this.mainUrl}/category.php?cat=${catMap[genre]}`;
        }
      }

      if (page > 1) {
        url += (url.includes('?') ? '&' : '?') + `page=${page}`;
      }

      const resp = await http.get(url, { timeout: 6000 });

      const items: ProviderItem[] = [];
      const seenIds = new Set<string>();

      resp.$('a[href*="watch.php"]').each((_, a) => {
        const href = resp.$(a).attr('href');
        const title = resp.$(a).text().trim() || resp.$(a).attr('title') || '';
        if (!title || !href || title.includes('.ribon') || title.length < 3) return;

        const cleanPath = href.replace(/^https?:\/\/[^/]+/, '');
        const id = this.formatId(cleanPath);
        if (seenIds.has(id)) return;
        seenIds.add(id);

        const poster = this.fixUrl(resp.$(a).find('img').attr('src'));

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

  async getMetaInternal(contentId: string, type: StremioContentType | string): Promise<ProviderDetail | null> {
    const fullUrl = this.fixUrl(contentId);
    const resp = await http.get(fullUrl);

    const title = resp.$('h1').first().text().trim() || resp.$('title').text().trim() || 'WeCima Title';
    const poster = this.fixUrl(resp.$('meta[property="og:image"]').attr('content') || resp.$('.video-bibplayer-poster').css('background-image')?.replace(/url\(['"]?(.*?)['"]?\)/, '$1'));
    const description = resp.$('meta[property="og:description"]').attr('content') || resp.$('.video-description').text().trim();

    return {
      id: this.formatId(contentId),
      provider: this.name,
      type: type === 'series' || fullUrl.includes('episode') ? 'series' : 'movie',
      title,
      poster,
      description,
      url: fullUrl,
    };
  }

  async getStreamsInternal(contentId: string, _type: StremioContentType | string, _episodeId?: string): Promise<ResolvedStream[]> {
    const fullUrl = this.fixUrl(contentId);
    const streams: ResolvedStream[] = [];

    // Extract vid param
    const vidMatch = fullUrl.match(/vid=([a-zA-Z0-9]+)/);
    const playUrl = vidMatch ? `${this.mainUrl}/play.php?vid=${vidMatch[1]}` : fullUrl;

    try {
      const playRes = await http.get(playUrl, { headers: { Referer: fullUrl } });
      const iframes: string[] = [];
      playRes.$('iframe').each((_, ifr) => {
        const src = playRes.$(ifr).attr('src');
        if (src) iframes.push(this.fixUrl(src));
      });

      for (const ifr of iframes) {
        const extracted = await extractStreams(ifr, playUrl);
        streams.push(...extracted);
      }
    } catch (e) {
      this.logger.debug(`Error getting WeCima streams: ${(e as Error).message}`);
    }

    return streams;
  }
}
