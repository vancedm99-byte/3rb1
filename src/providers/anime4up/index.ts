import { BaseProvider } from '../base.js';
import { ProviderCatalogDefinition, ProviderDetail, ProviderEpisode, ProviderItem, ResolvedStream } from '../../types/provider.js';
import { StremioContentType } from '../../types/stremio.js';
import { http, MOBILE_USER_AGENT } from '../../utils/http.js';
import { safeBase64Decode } from '../../utils/crypto.js';
import { extractStreams } from '../../extractors/index.js';

export class Anime4upProvider extends BaseProvider {
  id = 'anime4up';
  name = 'Anime4up (أنمي فور اب)';
  lang = 'ar';
  mainUrl = 'https://w1.anime4up.rest';
  supportedTypes: StremioContentType[] = ['anime', 'series', 'movie'];

  constructor() {
    super();
    this.initLogger();
  }

  getCatalogs(): ProviderCatalogDefinition[] {
    return [
      {
        id: 'anime',
        name: 'أنمي (Anime)',
        genres: ['الكل', 'أفلام أنمي', 'أكشن', 'مغامرات', 'كوميديا', 'دراما', 'شونين', 'خيال', 'غموض', 'رعب'],
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
      const url = `${this.mainUrl}/?search_string=${encodeURIComponent(query)}`;
      const resp = await http.get(url, {
        headers: { 'User-Agent': MOBILE_USER_AGENT },
        timeout: 6000,
      });

      const items: ProviderItem[] = [];
      const seenIds = new Set<string>();

      resp.$('div.anime-card-container').each((_, el) => {
        const a = resp.$(el).find('.anime-title a');
        const title = a.text().trim();
        const href = a.attr('href');
        if (!title || !href) return;

        const cleanPath = href.replace(/^https?:\/\/[^/]+/, '');
        const id = this.formatId(cleanPath);
        if (seenIds.has(id)) return;
        seenIds.add(id);

        const poster = this.fixUrl(resp.$(el).find('img').attr('data-src') || resp.$(el).find('img').attr('src'));
        const isMovie = title.includes('فيلم') || href.includes('/movie/');

        items.push({
          id,
          provider: this.name,
          type: isMovie ? 'movie' : 'anime',
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
      let path = 'anime-season';
      if (genre && genre !== 'الكل') {
        const genreMap: Record<string, string> = {
          'أفلام أنمي': 'anime-type/movie',
          'أكشن': 'anime-genre/action',
          'مغامرات': 'anime-genre/adventure',
          'كوميديا': 'anime-genre/comedy',
          'دراما': 'anime-genre/drama',
          'شونين': 'anime-genre/shounen',
          'خيال': 'anime-genre/fantasy',
          'غموض': 'anime-genre/mystery',
          'رعب': 'anime-genre/horror',
        };
        if (genreMap[genre]) {
          path = genreMap[genre];
        }
      } else if (catalogId === 'movie') {
        path = 'anime-type/movie';
      }

      const url = `${this.mainUrl}/${path}/page/${page}/`;
      const resp = await http.get(url, {
        headers: { 'User-Agent': MOBILE_USER_AGENT },
        timeout: 6000,
      });

      const items: ProviderItem[] = [];
      const seenIds = new Set<string>();

      resp.$('div.anime-card-container').each((_, el) => {
        const a = resp.$(el).find('.anime-title a');
        const title = a.text().trim();
        const href = a.attr('href');
        if (!title || !href) return;

        const cleanPath = href.replace(/^https?:\/\/[^/]+/, '');
        const id = this.formatId(cleanPath);
        if (seenIds.has(id)) return;
        seenIds.add(id);

        const poster = this.fixUrl(resp.$(el).find('img').attr('data-src') || resp.$(el).find('img').attr('src'));
        const isMovie = title.includes('فيلم') || href.includes('/movie/');

        items.push({
          id,
          provider: this.name,
          type: isMovie ? 'movie' : 'anime',
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
    const resp = await http.get(fullUrl, {
      headers: { 'User-Agent': MOBILE_USER_AGENT },
    });

    const title = resp.$('h1.anime-details-title').text().trim() || resp.$('meta[property="og:title"]').attr('content') || 'Anime Title';
    const poster = this.fixUrl(resp.$('.anime-thumbnail img').attr('src') || resp.$('meta[property="og:image"]').attr('content'));
    const description = resp.$('p.anime-story').text().trim();

    const episodes: ProviderEpisode[] = [];
    resp.$('div.episodes-card-container, div.DivEpisodesContainer a').each((idx, el) => {
      const a = resp.$(el).is('a') ? resp.$(el) : resp.$(el).find('a');
      const epHref = a.attr('href');
      const epTitle = a.text().trim() || `الحلقة ${idx + 1}`;
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

    return {
      id: this.formatId(contentId),
      provider: this.name,
      type: type === 'movie' ? 'movie' : 'anime',
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
    const resp = await http.get(fullUrl, {
      headers: { 'User-Agent': MOBILE_USER_AGENT },
    });

    const streams: ResolvedStream[] = [];
    const serverLinks: string[] = [];

    resp.$('ul#episode-servers li a, div.server-item a').each((_, a) => {
      let dataUrl = resp.$(a).attr('data-ep-url') || resp.$(a).attr('data-url') || resp.$(a).attr('href');
      if (dataUrl) {
        if (!dataUrl.startsWith('http') && dataUrl.length > 20) {
          const decoded = safeBase64Decode(dataUrl);
          if (decoded.startsWith('http')) dataUrl = decoded;
        }
        if (dataUrl.startsWith('http')) {
          serverLinks.push(dataUrl);
        }
      }
    });

    for (const link of serverLinks) {
      const extracted = await extractStreams(link, fullUrl);
      streams.push(...extracted);
    }

    return streams;
  }
}
