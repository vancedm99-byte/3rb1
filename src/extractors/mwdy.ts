import { http } from '../utils/http.js';
import { unpackAll } from '../utils/packer.js';
import { ResolvedStream } from '../types/provider.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('MwdyExtractor');

/**
 * Extractor for mwdy.cc / mwdy.club embeds
 * Commonly used as Server 2 / mirror host on 3isk
 */
export async function extractMwdy(url: string, referer?: string): Promise<ResolvedStream[]> {
  try {
    const resp = await http.get(url, {
      referer,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
    });

    if (resp.status !== 200) return [];

    const streams: ResolvedStream[] = [];
    const html = resp.text;

    // Unpack any packed JS
    const unpacked = unpackAll(html, url);

    // 1. Check for HLS master.m3u8
    const m3u8Matches = unpacked.match(/https?:\/\/[^'"\s\\]+?\.m3u8[^'"\s\\]*/g) || [];
    for (const m of m3u8Matches) {
      const cleanUrl = m.replace(/\\([/'"])/g, '$1');
      streams.push({
        name: 'Mwdy HLS',
        quality: '1080p / 720p',
        url: cleanUrl,
        isM3u8: true,
        headers: { Referer: url },
      });
    }

    // 2. Check for MP4 video
    const mp4Matches = unpacked.match(/https?:\/\/[^'"\s\\]+?\.mp4[^'"\s\\]*/g) || [];
    for (const m of mp4Matches) {
      const cleanUrl = m.replace(/\\([/'"])/g, '$1');
      streams.push({
        name: 'Mwdy MP4',
        quality: 'HD',
        url: cleanUrl,
        isM3u8: false,
        headers: { Referer: url },
      });
    }

    // 3. Fallback: check raw HTML
    if (streams.length === 0) {
      const rawM3u8 = html.match(/https?:\/\/[^'"\s\\]+?\.m3u8[^'"\s\\]*/g) || [];
      for (const m of rawM3u8) {
        streams.push({
          name: 'Mwdy Direct HLS',
          quality: '1080p / 720p',
          url: m.replace(/\\([/'"])/g, '$1'),
          isM3u8: true,
          headers: { Referer: url },
        });
      }
    }

    // Deduplicate
    const unique = new Map<string, ResolvedStream>();
    for (const s of streams) {
      if (!unique.has(s.url)) unique.set(s.url, s);
    }

    return Array.from(unique.values());
  } catch (err) {
    logger.debug(`Mwdy extraction failed for ${url}: ${(err as Error).message}`);
    return [];
  }
}
