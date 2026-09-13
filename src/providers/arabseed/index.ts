import { BaseProvider } from '../base.js';
import { ProviderCatalogDefinition, ProviderDetail, ProviderEpisode, ProviderItem, ResolvedStream } from '../../types/provider.js';
import { StremioContentType } from '../../types/stremio.js';
import { http, MOBILE_USER_AGENT } from '../../utils/http.js';
import { extractStreams } from '../../extractors/index.js';

export class ArabseedProvider extends BaseProvider {
  id = 'arabseed';
  name = 'Arabseed (عرب سيد)';
  lang = 'ar';
  mainUrl = 'https://arabseeds.watch';
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
        genres: ['الكل', 'افلام اجنبي', 'افلام عربي', 'افلام هندي', 'افلام تركي', 'افلام كرتون'],
      },
      {
        id: 'series',
        name: 'المسلسلات (Series)',
        genres: ['الكل', 'مسلسلات اجنبي', 'مسلسلات عربي', 'مسلسلات تركي', 'مسلسلات كرتون', 'مسلسلات هندي'],
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
      const url = `${this.mainUrl}/find/?find=${encodeURIComponent(query)}`;
      const resp = await http.get(url, { timeout: 6000 });

      const items: ProviderItem[] = [];
      const seenIds = new Set<string>();

      resp.$('a.movie__block, div.MovieBlock, div.PostBlock').each((_, el) => {
        const a = resp.$(el).is('a') ? resp.$(el) : resp.$(el).find('a').first();
        const title = resp.$(el).find('h3, h4, .BlockItemTitle, .Title').text().trim() || a.attr('title') || '';
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
      const isSeries = catalogId === 'series';
      let path = isSeries ? 'series' : 'movies';

      if (genre && genre !== 'الكل') {
        const categoryMap: Record<string, string> = {
          'افلام اجنبي': 'category/foreign-movies',
          'افلام عربي': 'category/arabic-movies-5',
          'افلام هندي': 'category/hindi-movies',
          'افلام تركي': 'category/turkish-movies',
          'افلام كرتون': 'category/anime-movies-2',
          'مسلسلات اجنبي': 'category/foreign-series',
          'مسلسلات عربي': 'category/arabic-series-1',
          'مسلسلات تركي': 'category/turkish-series-1',
          'مسلسلات كرتون': 'category/anime-series',
          'مسلسلات هندي': 'category/hindi-series',
        };
        if (categoryMap[genre]) {
          path = categoryMap[genre];
        }
      }

      const url = `${this.mainUrl}/${path}${page > 1 ? `/page/${page}/` : '/'}`;
      const resp = await http.get(url, { timeout: 6000 });

      const items: ProviderItem[] = [];
      const seenIds = new Set<string>();

      resp.$('a.movie__block, div.MovieBlock, div.PostBlock').each((_, el) => {
        const a = resp.$(el).is('a') ? resp.$(el) : resp.$(el).find('a').first();
        const title = resp.$(el).find('h3, h4, .BlockItemTitle, .Title').text().trim() || a.attr('title') || '';
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
    } catch {
      return [];
    }
  }

  async getMetaInternal(contentId: string, type: StremioContentType | string): Promise<ProviderDetail | null> {
    const fullUrl = this.fixUrl(contentId);
    const resp = await http.get(fullUrl);

    const title = resp.$('h1.Title, h1, h3').first().text().trim() || resp.$('meta[property="og:title"]').attr('content') || 'Arabseed Title';
    const poster = this.fixUrl(resp.$('.Poster img, .post__image img').attr('data-src') || resp.$('.Poster img, .post__image img').attr('src') || resp.$('meta[property="og:image"]').attr('content'));
    const description = resp.$('.Story p, .post__info p').text().trim();

    const episodes: ProviderEpisode[] = [];
    const isSeries = type === 'series' || fullUrl.includes('/series/');
    if (isSeries) {
      resp.$('a[href*="-الحلقة-"], a[href*="/episode-"], div.ContainerEpisodesList a').each((idx, el) => {
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
  }

  async getStreamsInternal(contentId: string, _type: StremioContentType | string, episodeId?: string): Promise<ResolvedStream[]> {
    const targetPath = episodeId || contentId;
    const fullUrl = this.fixUrl(targetPath);
    const resp = await http.get(fullUrl);

    const streams: ResolvedStream[] = [];
    const serverLinks: string[] = [];

    // 1. Find watch page link
    const watchBtnHref = resp.$('a[href*="/watch/"], a.watchBTn').attr('href');
    const watchPageUrl = watchBtnHref ? this.fixUrl(watchBtnHref) : `${fullUrl.replace(/\/$/, '')}/watch/`;

    try {
      const watchResp = await http.get(watchPageUrl, {
        headers: { Referer: fullUrl },
      });

      watchResp.$('.server-item[data-src], ul.serversList li[data-link], [data-embed]').each((_, el) => {
        const link = watchResp.$(el).attr('data-src') || watchResp.$(el).attr('data-link') || watchResp.$(el).attr('data-embed');
        if (link) serverLinks.push(this.fixUrl(link));
      });

      const iframeSrc = watchResp.$('iframe.player-frame, iframe[src*="embed"], iframe').attr('src');
      if (iframeSrc) serverLinks.push(this.fixUrl(iframeSrc));
    } catch (e) {
      this.logger.debug(`Error loading watch page: ${(e as Error).message}`);
    }

    // 2. Also check download page for mirrors
    const downloadBtnHref = resp.$('a[href*="/download/"]').attr('href');
    if (downloadBtnHref) {
      try {
        const downloadResp = await http.get(this.fixUrl(downloadBtnHref), {
          headers: { Referer: fullUrl },
        });
        downloadResp.$('a[href*="mixdrop"], a[href*="dood"], a[href*="myvid"]').each((_, a) => {
          const href = downloadResp.$(a).attr('href');
          if (href) {
            // Convert /d/ to /e/ for player embed
            const embedLink = href.replace('/d/', '/e/').replace('/f/', '/e/');
            serverLinks.push(embedLink);
          }
        });
      } catch {}
    }

    // 3. Resolve all servers
    for (const sUrl of serverLinks) {
      try {
        const extracted = await extractStreams(sUrl, watchPageUrl);
        streams.push(...extracted);
      } catch {}
    }

    return streams;
  }
}
