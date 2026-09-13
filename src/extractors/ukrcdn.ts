import { http } from '../utils/http.js';
import { ResolvedStream } from '../types/provider.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('UkrcdnExtractor');

/**
 * Extractor for ukrcdn.club / ukrcdn.xyz video players
 * Used by 3isk and other Arabic streaming platforms
 */
export async function extractUkrcdn(url: string, referer?: string): Promise<ResolvedStream[]> {
  try {
    const resp = await http.get(url, {
      referer,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
    });

    // Extract playback API call: fetch(".../playback?g=...")
    const playbackMatch = resp.text.match(/fetch\s*\(\s*["']([^"']*playback[^"']*)["']/i);
    if (!playbackMatch) {
      logger.debug(`No playback API found in ukrcdn embed: ${url}`);
      return [];
    }

    let playbackUrl = playbackMatch[1].replace(/\\([/'"])/g, '$1');
    if (!playbackUrl.startsWith('http')) {
      const baseOrigin = new URL(url).origin;
      playbackUrl = `${baseOrigin}${playbackUrl.startsWith('/') ? '' : '/'}${playbackUrl}`;
    }

    const pbResp = await http.get(playbackUrl, {
      headers: {
        Referer: url,
        Origin: new URL(url).origin,
        Accept: 'application/json',
      },
    });

    const pbJson = pbResp.json();
    if (pbJson && pbJson.url) {
      return [
        {
          name: 'Ukrcdn HLS',
          quality: '1080p / 720p',
          url: pbJson.url,
          isM3u8: true,
          headers: { Referer: new URL(url).origin + '/' },
        },
      ];
    }
  } catch (err) {
    logger.debug(`Ukrcdn extraction failed for ${url}: ${(err as Error).message}`);
  }

  return [];
}
