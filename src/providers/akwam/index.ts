import { BaseProvider } from '../base.js';
import { ProviderCatalogDefinition, ProviderDetail, ProviderEpisode, ProviderItem, ResolvedStream } from '../../types/provider.js';
import { StremioContentType } from '../../types/stremio.js';
import { http } from '../../utils/http.js';
import { extractStreams } from '../../extractors/index.js';

export class AkwamProvider extends BaseProvider {
  id = 'akwam';
  name = 'Akwam (أكوام)';
  lang = 'ar';
  mainUrl = 'https://akwam.ss';
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
        genres: ['الكل', 'عربي', 'أجنبي', 'أكشن', 'كوميدي', 'دراما', 'رعب', 'خيال علمي', 'هندي', 'تركي'],
      },
      {
        id: 'series',
        name: 'المسلسلات (Series)',
        genres: ['الكل', 'عربي', 'تركي', 'أجنبي', 'آسيوي', 'كارتون وإنيمي', 'دراما', 'أكشن'],
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
    const url = `${this.mainUrl}/search?q=${encodeURIComponent(query)}`;
    const resp = await http.get(url);
    const items: ProviderItem[] = [];
    const seenIds = new Set<string>();

    const entries = resp.$('div.widget-body div.entry-box');
    const elements = entries.length > 0 ? entries : resp.$('div.entry-box');

    elements.each((_, el) => {
      const titleEl = resp.$(el).find('h3.entry-title a, .entry-title a');
      const title = titleEl.text().trim();
      const href = resp.$(el).find('a').first().attr('href') || titleEl.attr('href');
      if (!title || !href) return;

      const cleanPath = href.replace(/^https?:\/\/[^/]+/, '');
      const id = this.formatId(cleanPath);
      if (seenIds.has(id)) return;
      seenIds.add(id);

      const poster = this.fixUrl(resp.$(el).find('img').attr('data-src') || resp.$(el).find('img').attr('src'));
      const isSeries = href.includes('/series/') || title.includes('مسلسل');
      const yearMatch = title.match(/\b(19\d\d|20\d\d)\b/);

      items.push({
        id,
        provider: this.name,
        type: isSeries ? 'series' : 'movie',
        title,
        poster,
        year: yearMatch ? parseInt(yearMatch[1], 10) : undefined,
        url: this.fixUrl(href),
      });
    });

    return items;
  }

  async getCatalogInternal(catalogId: string, page: number = 1, genre?: string): Promise<ProviderItem[]> {
    const isSeries = catalogId === 'series';
    const basePath = isSeries ? 'series' : 'movies';
    const params: string[] = [];

    if (page > 1) {
      params.push(`page=${page}`);
    }

    if (genre && genre !== 'الكل') {
      const genreMap: Record<string, string> = {
        'عربي': 'section=29',
        'أجنبي': 'section=30',
        'كارتون وإنيمي': 'section=31',
        'أنمي': 'section=32',
        'تركي': isSeries ? 'section=32' : 'section=35',
        'هندي': isSeries ? 'section=35' : 'section=33',
        'آسيوي': 'section=34',
        'أكشن': 'category=39',
        'دراما': 'category=42',
        'كوميدي': 'category=43',
        'رعب': 'category=44',
        'خيال علمي': 'category=46',
      };
      if (genreMap[genre]) {
        params.push(genreMap[genre]);
      }
    }

    const queryStr = params.length > 0 ? `?${params.join('&')}` : '';
    const url = `${this.mainUrl}/${basePath}${queryStr}`;
    const resp = await http.get(url);
    const items: ProviderItem[] = [];
    const seenIds = new Set<string>();

    const entries = resp.$('div.widget-body div.entry-box');
    const elements = entries.length > 0 ? entries : resp.$('div.entry-box');

    elements.each((_, el) => {
      const titleEl = resp.$(el).find('h3.entry-title a, .entry-title a');
      const title = titleEl.text().trim();
      const href = resp.$(el).find('a').first().attr('href') || titleEl.attr('href');
      if (!title || !href) return;

      const cleanPath = href.replace(/^https?:\/\/[^/]+/, '');
      const id = this.formatId(cleanPath);
      if (seenIds.has(id)) return;
      seenIds.add(id);

      const poster = this.fixUrl(resp.$(el).find('img').attr('data-src') || resp.$(el).find('img').attr('src'));
      const yearMatch = title.match(/\b(19\d\d|20\d\d)\b/);

      items.push({
        id,
        provider: this.name,
        type: isSeries ? 'series' : 'movie',
        title,
        poster,
        year: yearMatch ? parseInt(yearMatch[1], 10) : undefined,
        url: this.fixUrl(href),
      });
    });

    return items;
  }

  async getMetaInternal(contentId: string, type: StremioContentType | string): Promise<ProviderDetail | null> {
    const fullUrl = this.fixUrl(contentId);
    const resp = await http.get(fullUrl);

    const title = resp.$('h1.entry-title').text().trim() || resp.$('meta[property="og:title"]').attr('content') || 'Akwam Title';
    const poster = this.fixUrl(resp.$('meta[property="og:image"]').attr('content') || resp.$('.picture img').attr('src'));
    const description = resp.$('.widget-body p.text-white').text().trim() || resp.$('meta[name="description"]').attr('content');

    const episodes: ProviderEpisode[] = [];
    const isSeries = type === 'series' || fullUrl.includes('/series/');
    if (isSeries) {
      resp.$('div.widget-body div.entry-box').each((idx, el) => {
        const epLink = resp.$(el).find('a').attr('href');
        const epTitle = resp.$(el).find('.entry-title').text().trim() || `حلقة ${idx + 1}`;
        if (!epLink) return;

        const epNumMatch = epTitle.match(/حلقة\s*(\d+)/i) || epLink.match(/episode-(\d+)/i);
        const epNum = epNumMatch ? parseInt(epNumMatch[1], 10) : idx + 1;
        const seasonNumMatch = epTitle.match(/موسم\s*(\d+)/i) || fullUrl.match(/season-(\d+)/i);
        const seasonNum = seasonNumMatch ? parseInt(seasonNumMatch[1], 10) : 1;

        episodes.push({
          id: this.formatId(epLink.replace(this.mainUrl, '')),
          title: epTitle,
          season: seasonNum,
          episode: epNum,
          url: this.fixUrl(epLink),
          poster,
        });
      });
    }

    return {
      id: this.formatId(contentId),
      provider: this.name,
      type: isSeries ? 'series' : 'movie',
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
    const directLinks: string[] = [];

    resp.$('a.link-btn[href*="/watch/"], a.link-btn[href*="/download/"]').each((_, el) => {
      const link = resp.$(el).attr('href');
      if (link) directLinks.push(this.fixUrl(link));
    });

    for (const dl of directLinks) {
      try {
        const dlResp = await http.get(dl, { referer: fullUrl });
        const extracted = await extractStreams(dl, fullUrl);
        streams.push(...extracted);

        // Check if dlResp contains direct player hrefs
        dlResp.$('a[href*=".mp4"], a[href*=".m3u8"]').each((_, a) => {
          const streamUrl = dlResp.$(a).attr('href');
          if (streamUrl) {
            streams.push({
              name: 'Akwam Direct',
              url: streamUrl,
              isM3u8: streamUrl.includes('.m3u8'),
              headers: { Referer: dl },
            });
          }
        });
      } catch (e) {
        this.logger.debug(`Error fetching download page: ${(e as Error).message}`);
      }
    }

    return streams.filter(s => s.url && s.url.startsWith('http'));
  }
}
