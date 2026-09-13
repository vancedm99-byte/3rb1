import { BaseProvider } from '../base.js';
import { ProviderCatalogDefinition, ProviderDetail, ProviderEpisode, ProviderItem, ResolvedStream } from '../../types/provider.js';
import { StremioContentType } from '../../types/stremio.js';
import { http } from '../../utils/http.js';
import { safeBase64Decode } from '../../utils/crypto.js';
import { unpackAll } from '../../utils/packer.js';
import { isCaptchaChallenge } from '../../utils/captcha.js';
import { extractStreams } from '../../extractors/index.js';

export class ThreeIskProvider extends BaseProvider {
  id = '3isk';
  name = '3isk - قصة عشق (مسلسلات تركية)';
  lang = 'ar';
  mainUrl = 'https://3iskk.xyz';
  supportedTypes: StremioContentType[] = ['series', 'movie'];

  constructor() {
    super();
    this.initLogger();
  }

  getCatalogs(): ProviderCatalogDefinition[] {
    return [
      {
        id: 'series',
        name: 'مسلسلات تركية (Turkish Series)',
        genres: ['الكل', 'مسلسلات تركية مترجمة', 'مسلسلات تركية مدبلجة', 'مسلسلات تركية قديمة'],
      },
      {
        id: 'movies',
        name: 'أفلام تركية (Turkish Movies)',
        genres: ['الكل', 'أفلام تركية مترجمة', 'أفلام تركية مدبلجة'],
      },
    ];
  }

  private cleanPath(url?: string): string {
    if (!url) return '';
    return url.replace(/^https?:\/\/[^/]+/, '');
  }

  private fixUrl(url?: string): string {
    if (!url) return '';
    if (url.startsWith('//')) return `https:${url}`;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return `${this.mainUrl}${url.startsWith('/') ? '' : '/'}${url}`;
  }

  private extractItemUrl(el: any, $: any): string {
    const dataClse = $(el).attr('data-clse');
    if (dataClse) {
      const decoded = safeBase64Decode(dataClse);
      if (decoded.startsWith('http') || decoded.startsWith('/')) {
        return this.fixUrl(decoded);
      }
    }
    const a = $(el).find('a').first();
    const href = a.attr('href');
    return href ? this.fixUrl(href) : '';
  }

  async searchInternal(query: string): Promise<ProviderItem[]> {
    try {
      const url = `${this.mainUrl}/search.php?keywords=${encodeURIComponent(query)}`;
      const resp = await http.get(url, { timeout: 6000 });

      const items: ProviderItem[] = [];
      const seenIds = new Set<string>();

      resp.$('div.post-item, div.block-post, div.video-item').each((_, el) => {
        const a = resp.$(el).find('a').first();
        const title = resp.$(el).find('.post-title, .title').text().trim() || a.attr('title') || '';
        const href = this.extractItemUrl(el, resp.$);
        if (!title || !href) return;

        const cleanPath = this.cleanPath(href);
        const id = this.formatId(cleanPath);
        if (seenIds.has(id)) return;
        seenIds.add(id);

        const poster = this.fixUrl(resp.$(el).find('img').attr('data-src') || resp.$(el).find('img').attr('src'));
        const isMovie = href.includes('/movie') || href.includes('/film') || title.includes('فيلم');

        items.push({
          id,
          provider: this.name,
          type: isMovie ? 'movie' : 'series',
          title,
          poster,
          url: href,
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
      let path = isSeries ? 'w-srs' : 'w-mvs';
      if (genre && genre !== 'الكل') {
        const catMap: Record<string, string> = {
          'مسلسلات تركية مترجمة': 'category/مسلسلات-تركية-مترجمة',
          'مسلسلات تركية مدبلجة': 'category/مسلسلات-تركية-مدبلجة',
          'مسلسلات تركية قديمة': 'category/مسلسلات-تركية-قديمة',
          'أفلام تركية مترجمة': 'category/افلام-تركية-مترجمة',
          'أفلام تركية مدبلجة': 'category/افلام-تركية-مدبلجة',
        };
        if (catMap[genre]) {
          path = catMap[genre];
        }
      }

      const url = `${this.mainUrl}/${path}/${page > 1 ? `page/${page}/` : ''}`;
      const resp = await http.get(url, { timeout: 6000 });

      const items: ProviderItem[] = [];
      const seenIds = new Set<string>();

      resp.$('a[href*="/serie-"], a[href*="/tvshows/"], a[href*="/movies/"], a[href*="/movie-"], a[href*="/film-"], div.post-item, div.block-post, li.type_item_box a.type_item, a.type_item').each((_, el) => {
        const a = resp.$(el).is('a') ? resp.$(el) : resp.$(el).find('a').first();
        const rawTitle = resp.$(el).find('.post-title, .title').text().trim() || a.text().trim() || a.attr('title') || '';
        const title = rawTitle.replace(/\s+/g, ' ').trim();
        const href = a.attr('href');
        if (!title || !href) return;

        const cleanPath = this.cleanPath(href);
        const id = this.formatId(cleanPath);
        if (seenIds.has(id)) return;
        seenIds.add(id);

        const poster = this.fixUrl(
          resp.$(el).find('img').attr('data-src') || resp.$(el).find('img').attr('src') || a.find('img').attr('src')
        );

        const isMovie = href.includes('/movie') || href.includes('/film') || title.includes('فيلم') || catalogId === 'movies';

        items.push({
          id,
          provider: this.name,
          type: isMovie ? 'movie' : 'series',
          title,
          poster,
          url: href,
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

    const title = resp.$('h1.entry-title, .post-title, h1.title, .single_info h1').text().trim() || resp.$('meta[property="og:title"]').attr('content') || '3isk Title';
    const poster = this.fixUrl(resp.$('.post-thumbnail img, .poster-wrapper img').attr('src') || resp.$('meta[property="og:image"]').attr('content'));
    const description = resp.$('.entry-content p, .story, .description').text().trim();

    const episodes: ProviderEpisode[] = [];
    resp.$('ul.episodes-list li, div.episodes-container a, div.all-episodes a').each((idx, el) => {
      const a = resp.$(el).is('a') ? resp.$(el) : resp.$(el).find('a');
      const epHref = this.extractItemUrl(el, resp.$) || a.attr('href');
      const epTitle = a.text().trim() || `حلقة ${idx + 1}`;
      if (!epHref) return;

      const epNumMatch = epTitle.match(/(\d+)/);
      const epNum = epNumMatch ? parseInt(epNumMatch[1], 10) : idx + 1;

      const cleanEp = this.cleanPath(epHref);
      episodes.push({
        id: this.formatId(cleanEp),
        title: epTitle,
        season: 1,
        episode: epNum,
        url: this.fixUrl(cleanEp),
        poster,
      });
    });

    return {
      id: this.formatId(this.cleanPath(contentId)),
      provider: this.name,
      type: type === 'movie' ? 'movie' : 'series',
      title,
      poster,
      description,
      url: fullUrl,
      episodes: episodes.length > 0 ? episodes : undefined,
    };
  }

  /**
   * Resolves streams for a specific candidate embed URL across known embed hosts
   * with per-host captcha isolation and nested iframe extraction.
   */
  private async resolveEmbedHost(
    embedUrl: string,
    serverNum: number,
    refererUrl: string
  ): Promise<ResolvedStream[]> {
    const results: ResolvedStream[] = [];
    try {
      // 1. Check if the embedUrl itself can be handled directly by an extractor (e.g. direct ukrcdn, miravd, mwdy, vidoba)
      try {
        const direct = await extractStreams(embedUrl, refererUrl);
        for (const s of direct) {
          results.push({
            name: `3isk - سيرفر ${serverNum} (${s.name})`,
            quality: s.quality || '1080p / 720p',
            url: s.url,
            isM3u8: s.isM3u8,
            headers: s.headers || { Referer: embedUrl },
          });
        }
      } catch (directErr) {
        this.logger.debug(`Direct extractStreams error on ${embedUrl}: ${(directErr as Error).message}`);
      }

      // 2. Fetch the embed page HTML to inspect child iframes / video tags
      const embedResp = await http.get(embedUrl, {
        headers: { Referer: refererUrl },
        timeout: 8000,
      });

      if (embedResp.status !== 200) {
        return results;
      }

      // Check if this specific embed host returned a captcha challenge
      if (isCaptchaChallenge(embedResp.text, embedResp.status)) {
        this.logger.warn(
          `Server ${serverNum} embed (${embedUrl}) returned a captcha challenge; isolating and skipping this host to allow sibling mirrors to resolve.`
        );
        return results;
      }

      // 3. Scan for ukrcdn players
      const ukrcdnMatches: string[] = Array.from(
        embedResp.text.match(/https?:\/\/ukrcdn\.[a-z]+\/e\/[a-zA-Z0-9-]+/gi) || []
      );
      for (const ukr of ukrcdnMatches) {
        try {
          const ukrStreams = await extractStreams(ukr, embedUrl);
          for (const s of ukrStreams) {
            results.push({
              name: `3isk - سيرفر ${serverNum} (${s.name})`,
              quality: s.quality || '1080p / 720p',
              url: s.url,
              isM3u8: s.isM3u8,
              headers: s.headers,
            });
          }
        } catch (err) {
          this.logger.debug(`UkrCdn error on server ${serverNum}: ${(err as Error).message}`);
        }
      }

      // 4. Scan for nested iframes (mwdy, miravd, vidoba, etc.)
      const nestedIframes: string[] = [];
      embedResp.$('iframe[src]').each((_, f) => {
        const s = embedResp.$(f).attr('src');
        if (s && s.startsWith('http') && !s.includes('googletagmanager')) {
          nestedIframes.push(s);
        }
      });

      // Also check text matches for embed links
      const textMatches = embedResp.text.match(/https?:\/\/[^'"\s<>]+\/embed-[a-zA-Z0-9]+\.html/g) || [];
      for (const tm of textMatches) {
        if (!nestedIframes.includes(tm)) nestedIframes.push(tm);
      }

      for (const nestedUrl of nestedIframes) {
        try {
          // Check if nested URL is captcha gated or extract streams
          const extracted = await extractStreams(nestedUrl, embedUrl);
          for (const s of extracted) {
            results.push({
              name: `3isk - سيرفر ${serverNum} (${s.name})`,
              quality: s.quality || '1080p / 720p',
              url: s.url,
              isM3u8: s.isM3u8,
              headers: s.headers || { Referer: nestedUrl },
            });
          }
        } catch (nestedErr) {
          this.logger.debug(`Error resolving nested iframe ${nestedUrl}: ${(nestedErr as Error).message}`);
        }
      }
    } catch (err) {
      this.logger.debug(`Error on embed server ${serverNum} (${embedUrl}): ${(err as Error).message}`);
    }

    return results;
  }

  async getStreamsInternal(contentId: string, _type: StremioContentType | string, episodeId?: string): Promise<ResolvedStream[]> {
    const targetPath = (episodeId || contentId).replace(/^3isk:/, '');
    const fullUrl = this.fixUrl(targetPath);
    this.logger.debug(`Fetching watch page: ${fullUrl}`);

    const resp = await http.get(fullUrl);
    if (resp.status === 404 || !resp.text || resp.text.length < 200) {
      this.logger.info(`Watch page returned ${resp.status} for ${fullUrl} (confirmed unavailable upstream)`);
      return [];
    }

    const streams: ResolvedStream[] = [];

    // Extract post ID from comment_post_ID input, metadata, or URL slug
    const postId =
      resp.$('input[name="comment_post_ID"]').attr('value') ||
      resp.text.match(/post[_-]id["'\s:=]+(\d+)/i)?.[1] ||
      resp.text.match(/"postID":\s*(\d+)/)?.[1] ||
      targetPath.match(/-m(\d+)p/)?.[1];

    let handshakeSucceeded = false;

    // Stage 1 & 2: Locate watch token form and perform initial POST handshake
    // 3isk protects embed links behind a 2-stage handshake:
    // 1) POST to aa.3isk.icu/3isk*.php with form tokens 'news' and 'u' and 'submit'
    // 2) The server responds with JS setting 'myUrl' and 'myInput.value' for stage 2
    const form = resp.$('form:has(input[name="news"]), form:has(button.single-watch-btn)').first();
    const actionUrl = form.attr('action') || resp.$('form[action*="3isk"]').first().attr('action');
    const newsVal = form.find('input[name="news"]').attr('value') || '';
    const uVal = form.find('input[name="u"]').attr('value') || '';
    const submitBtn = form.find('button.single-watch-btn');
    const submitName = submitBtn.attr('name') || 'submit';
    const submitVal = submitBtn.attr('value') || 'submit';

    if (actionUrl && newsVal) {
      try {
        const post1Url = this.fixUrl(actionUrl);
        this.logger.debug(`Handshake Stage 1 POST to ${post1Url}`);

        const post1Data: Record<string, string> = {
          news: newsVal,
          u: uVal,
          [submitName]: submitVal,
        };

        const step2Resp = await http.post(post1Url, {
          form: post1Data,
          headers: {
            Referer: fullUrl,
            Origin: new URL(fullUrl).origin,
          },
        });

        // Step 2 contains var myUrl = '...' and myInput.value = '...'
        const myUrlMatch = step2Resp.text.match(/var\s+myUrl\s*=\s*['"]([^'"]+)['"]/);
        const nextNewsMatch = step2Resp.text.match(/myInput\.value\s*=\s*['"]([^'"]+)['"]/);

        if (myUrlMatch && nextNewsMatch) {
          handshakeSucceeded = true;
          const step3Url = this.fixUrl(myUrlMatch[1]);
          const step3News = nextNewsMatch[1];
          this.logger.debug(`Handshake Stage 2 POST to ${step3Url}`);

          // Stage 3: Second POST handshake to obtain player embeds
          const step3Resp = await http.post(step3Url, {
            form: {
              news: step3News,
              u: '',
              submit: 'submit',
            },
            headers: {
              Referer: step2Resp.url || post1Url,
              Origin: new URL(post1Url).origin,
            },
          });

          // Stage 4: Collect base embed URLs from response
          const baseEmbedUrls: string[] = [];
          step3Resp.$('iframe[src]').each((_, ifr) => {
            const src = step3Resp.$(ifr).attr('src');
            if (src && !src.includes('googletagmanager')) {
              baseEmbedUrls.push(this.fixUrl(src));
            }
          });

          const textEmbeds = step3Resp.text.match(/https?:\/\/[^'"\s<>]+\/embed\/[^'"\s<>]+/g) || [];
          for (const u of textEmbeds) {
            const fixed = this.fixUrl(u);
            if (!baseEmbedUrls.includes(fixed)) baseEmbedUrls.push(fixed);
          }

          // Generate mirror servers 1..5 for each embed pattern (e.g. /embed/1/264367/2/ -> /embed/{1..5}/...)
          const candidateEmbeds: { url: string; serverNum: number }[] = [];
          for (const baseIfr of baseEmbedUrls) {
            const embedMatch = baseIfr.match(/(https?:\/\/[^/]+\/embed\/)(\d+)\/(.*)/);
            if (embedMatch) {
              const prefix = embedMatch[1];
              const trailing = embedMatch[3];
              for (let s = 1; s <= 5; s++) {
                candidateEmbeds.push({ url: `${prefix}${s}/${trailing}`, serverNum: s });
              }
            } else {
              candidateEmbeds.push({ url: baseIfr, serverNum: 1 });
            }
          }

          // Stage 5: Iterate over candidate embed servers with per-host captcha isolation
          for (const item of candidateEmbeds) {
            const hostStreams = await this.resolveEmbedHost(item.url, item.serverNum, step3Resp.url || step3Url);
            streams.push(...hostStreams);
          }
        } else {
          this.logger.debug(
            `Handshake Stage 1 returned no next token for ${fullUrl}. Attempting multi-server mirror recovery...`
          );
        }
      } catch (err) {
        this.logger.error(`Error during 3isk handshake: ${(err as Error).message}`);
      }
    }

    // MULTI-SERVER FALLBACK:
    // If handshake produced no tokens or yielded 0 streams, probe alternate mirror servers 1..5
    // using the content post ID across known embed host endpoints.
    if (!handshakeSucceeded || streams.length === 0) {
      if (postId) {
        this.logger.debug(`Initiating multi-server probe for postId ${postId} across servers 1..5`);
        const serversTried: { server: number; url: string; status: string }[] = [];

        for (let s = 1; s <= 5; s++) {
          const candidateUrls = [
            `${this.mainUrl}/embed/${s}/${postId}/1/`,
            `${this.mainUrl}/embed/${s}/${postId}/2/`,
            `https://aa.3isk.icu/embed/${s}/${postId}/1/`,
          ];

          let serverResolved = false;
          for (const candUrl of candidateUrls) {
            try {
              const candStreams = await this.resolveEmbedHost(candUrl, s, fullUrl);
              if (candStreams.length > 0) {
                streams.push(...candStreams);
                serverResolved = true;
                serversTried.push({ server: s, url: candUrl, status: `resolved (${candStreams.length} streams)` });
                break;
              }
            } catch (probeErr) {
              this.logger.debug(`Server ${s} probe error on ${candUrl}: ${(probeErr as Error).message}`);
            }
          }

          if (!serverResolved) {
            serversTried.push({ server: s, url: candidateUrls[0], status: 'no streams / unavailable' });
          }
        }

        this.logger.debug(
          `Multi-server probe completed for ${fullUrl}: ${serversTried.map((t) => `S${t.server}=${t.status}`).join(', ')}`
        );
      }
    }

    // Direct fallback: check iframes on the initial watch page
    if (streams.length === 0) {
      const iframes: string[] = [];
      resp.$('iframe[src]').each((_, ifr) => {
        const src = resp.$(ifr).attr('src');
        if (src && !src.includes('googletagmanager')) {
          iframes.push(this.fixUrl(src));
        }
      });

      for (const ifrUrl of iframes) {
        try {
          const extracted = await extractStreams(ifrUrl, fullUrl);
          streams.push(...extracted);
        } catch {}
      }
    }

    // Deduplicate streams by URL
    const seenUrls = new Set<string>();
    const uniqueStreams: ResolvedStream[] = [];
    for (const s of streams) {
      if (!seenUrls.has(s.url)) {
        seenUrls.add(s.url);
        uniqueStreams.push(s);
      }
    }

    if (uniqueStreams.length > 0) {
      this.logger.info(`Resolved ${uniqueStreams.length} streams for ${fullUrl}`);
    } else {
      this.logger.info(`All mirror servers and fallback paths attempted for ${fullUrl}. No valid streams resolved; confirmed unavailable upstream.`);
    }

    return uniqueStreams;
  }
}
