import { manifest } from '../addon/manifest.js';
import { registry } from '../providers/index.js';
import { unpackPacker, unpackAll } from '../utils/packer.js';
import { decryptYacine, decryptWitAnimeEpisodeData, safeBase64Decode } from '../utils/crypto.js';
import { MemoryCache } from '../utils/cache.js';
import { extractMiraVd, extractMwdy, extractVidoba, extractUkrcdn } from '../extractors/index.js';
import { http } from '../utils/http.js';
import {
  disableSolver,
  resetSolverStateForTesting,
  isSolverDegraded,
  isSolverAvailable,
  getDependentProviders,
  getOrSolveClearance,
} from '../utils/cloudflareSolver.js';
import { BaseProvider } from '../providers/base.js';
import { IProvider } from '../types/provider.js';
import { StremioContentType } from '../types/stremio.js';

export async function runTests() {
  console.log('--- STARTING STREMIO ADDON TESTS ---');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, desc: string) {
    if (condition) {
      console.log(`  ✓ PASS: ${desc}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${desc}`);
      failed++;
    }
  }

  // 1. Manifest Validation
  console.log('\n[Test Suite 1: Manifest Validation]');
  assert(manifest.id === 'community.re3arabi.addon', 'Manifest ID is correct');
  assert(manifest.name.includes('Re-3arabi'), 'Manifest Name contains Re-3arabi');
  assert(manifest.resources.includes('catalog') && manifest.resources.includes('stream'), 'Resources include catalog & stream');
  assert(manifest.types.includes('movie') && manifest.types.includes('series') && manifest.types.includes('tv'), 'Types include movie, series, tv');
  assert((manifest.catalogs || []).length >= 10, 'Has catalogs for all registered providers');
  assert((manifest.idPrefixes || []).length === 10, 'All 10 provider ID prefixes registered in manifest');

  // Verify per-provider types and genre extra options
  const akwamCatalog = (manifest.catalogs || []).find((c) => c.type.includes('Akwam'));
  assert(!!akwamCatalog, 'Manifest exposes Akwam as a distinct type');
  const akwamGenre = akwamCatalog?.extra?.find((e) => e.name === 'genre');
  assert(!!akwamGenre && (akwamGenre.options || []).length > 0, 'Akwam catalog includes genre dropdown options');

  const yacineCatalog = (manifest.catalogs || []).find((c) => c.type.includes('Yacine'));
  assert(!!yacineCatalog, 'Manifest exposes Yacine TV as a distinct type with live catalogs');

  // Verify all providers have getCatalogs implemented
  const allProviders = registry.getAllProviders();
  const allHaveCatalogs = allProviders.every((p) => typeof p.getCatalogs === 'function' && p.getCatalogs().length > 0);
  assert(allHaveCatalogs, 'Every registered provider implements getCatalogs() with at least 1 catalog');

  // 2. Provider Registry
  console.log('\n[Test Suite 2: Provider Registry]');
  const providers = registry.getAllProviders();
  assert(providers.length === 10, `Loaded all 10 target providers (found ${providers.length})`);

  const expectedIds = ['akwam', 'faselhd', 'arabseed', 'wecima', 'anime4up', 'syrialive', 'yacinetv', 'witanime', '3isk', 'egydead'];
  for (const id of expectedIds) {
    const p = registry.getProvider(id);
    assert(!!p, `Provider "${id}" is properly instantiated and registered`);
  }

  // 3. ID Parsing & Namespacing Round-Trip
  console.log('\n[Test Suite 3: ID Parsing & Namespacing]');
  const testId1 = 'akwam:series/12345';
  const parsed1 = registry.parseProviderAndId(testId1);
  assert(parsed1.provider?.id === 'akwam' && parsed1.contentId === 'series/12345', 'Namespaced ID parses correctly');

  const testId2 = 'yacinetv:channel/42';
  const parsed2 = registry.parseProviderAndId(testId2);
  assert(parsed2.provider?.id === 'yacinetv' && parsed2.contentId === 'channel/42', 'Live TV ID parses correctly');

  // 4. Crypto & Deobfuscation Algorithms
  console.log('\n[Test Suite 4: Deobfuscation & Decryption Algorithms]');
  // Base64 safe decoding
  const b64Input = 'aHR0cHM6Ly9leGFtcGxlLmNvbS9zdHJlYW0ubTN1OA';
  const decodedB64 = safeBase64Decode(b64Input);
  assert(decodedB64 === 'https://example.com/stream.m3u8', 'Base64 decodes URL correctly');

  // YacineTV XOR Decryption Test
  // Generate a test XOR payload with baseKey "c!xZj+N9&G@Ev@vw" + t "12345"
  const tHeader = '12345';
  const key = 'c!xZj+N9&G@Ev@vw12345';
  const plainText = JSON.stringify({ status: 200, data: [{ id: 1, name: 'beIN Sports 1' }] });
  const cipherBuf = Buffer.alloc(plainText.length);
  for (let i = 0; i < plainText.length; i++) {
    cipherBuf[i] = plainText.charCodeAt(i) ^ key.charCodeAt(i % key.length);
  }
  const encryptedBase64 = cipherBuf.toString('base64');
  const decryptedYacine = decryptYacine(encryptedBase64, tHeader);
  assert(decryptedYacine === plainText, 'YacineTV XOR cipher decrypts accurately');

  // WitAnime XOR Test
  const part1 = Buffer.from('hello_witanime_stream');
  const part2 = Buffer.from('secret_xor_key');
  const xored = Buffer.alloc(part1.length);
  for (let i = 0; i < part1.length; i++) {
    xored[i] = part1[i] ^ part2[i % part2.length];
  }
  const encodedWit = `${xored.toString('base64')}.${part2.toString('base64')}`;
  const decryptedWit = decryptWitAnimeEpisodeData(encodedWit);
  assert(decryptedWit === 'hello_witanime_stream', 'WitAnime dual-buffer XOR decryption works');

  // Dean Edwards Unpacker Test
  const packedScript = `eval(function(p,a,c,k,e,d){while(c--)if(k[c])p=p.replace(new RegExp('\\\\b'+c.toString(a)+'\\\\b','g'),k[c]);return p}('1 0="2";',3,3,'stream|var|https'.split('|')))`;
  const unpacked = unpackPacker(packedScript);
  assert(!!unpacked && unpacked.includes('var stream="https"'), 'Dean Edwards unpacker resolves successfully');

  // 5. Cache Module
  console.log('\n[Test Suite 5: In-Memory TTL Cache]');
  const cache = new MemoryCache(10);
  cache.set('key1', 'test_value', 10);
  assert(cache.get('key1') === 'test_value', 'Cache returns saved value');
  cache.delete('key1');
  assert(cache.get('key1') === null, 'Cache correctly deletes value');

  // 6. Provider Isolation
  console.log('\n[Test Suite 6: Provider Isolation & Graceful Fallback]');
  const invalidResult = await registry.getMeta('nonexistent:123', 'movie');
  assert(invalidResult === null, 'Non-existent provider gracefully returns null without crashing');

  // 7. 3isk Stream Resolution (Target Prompt #3 regression test)
  console.log('\n[Test Suite 7: 3isk Stream Resolution & 2-Stage Handshake]');
  const threeIsk = registry.getProvider('3isk');
  assert(!!threeIsk, '3isk provider is registered in registry');

  if (threeIsk) {
    try {
      // Test movie stream resolution
      console.log('  -> Resolving 3isk movie streams...');
      const movieStreams = await threeIsk.getStreams('/watch/movies/movie-sultana-2026/', 'movie');
      assert(movieStreams.length > 0, `3isk movie stream resolution returns playable streams (found ${movieStreams.length})`);
      if (movieStreams.length > 0) {
        const s = movieStreams[0];
        assert(s.url.startsWith('http') && (s.url.includes('.m3u8') || s.url.includes('.mp4')), '3isk movie stream URL is valid m3u8/mp4');
        assert(!!s.headers && !!s.headers.Referer, '3isk movie stream contains necessary Referer headers');
      }

      // Test series episode stream resolution
      console.log('  -> Resolving 3isk episode streams...');
      const epStreams = await threeIsk.getStreams('/watch/episodes/serie-yasamayanlar-muddblij-season-1-ep-8-m453p/', 'series');
      assert(epStreams.length > 0, `3isk episode stream resolution returns unpacked streams (found ${epStreams.length})`);
      if (epStreams.length > 0) {
        const s = epStreams[0];
        assert(s.url.startsWith('http') && (s.url.includes('.m3u8') || s.url.includes('.mp4')), '3isk episode stream URL is valid unpacked m3u8/mp4');
        assert(s.isM3u8 === true, '3isk unpacked episode stream identified as HLS (isM3u8=true)');
      }

      // Test previously failed "no-token" title recovered via multi-server fallback
      console.log('  -> Resolving 3isk recovered title (movie-cahim-2025)...');
      const cahimStreams = await threeIsk.getStreams('/watch/movies/movie-cahim-2025/', 'movie');
      assert(Array.isArray(cahimStreams) && cahimStreams.length > 0, `3isk multi-server recovery resolves streams for movie-cahim-2025 (found ${cahimStreams.length})`);

      // Test graceful handling of genuinely unavailable upstream title (404)
      console.log('  -> Resolving 3isk genuinely unavailable title (movie-leila-2026)...');
      const unavailableStreams = await threeIsk.getStreams('/watch/movies/movie-leila-2026/', 'movie');
      assert(Array.isArray(unavailableStreams) && unavailableStreams.length === 0, 'Unavailable upstream video returns empty array gracefully without crashing');
    } catch (err) {
      assert(false, `3isk stream resolution threw error: ${(err as Error).message}`);
    }
  }

  // 8. 3isk Dedicated Host Extractors (Target Prompt #4)
  console.log('\n[Test Suite 8: Dedicated Host Extractors & Unpacker Variants]');
  
  // Unpacker parameter variation test (p, a, c, k, e, r with spaces)
  const variantPacked = `eval( function( p , a , c , k , e , r ){ while( c-- ) if( k[c] ) p=p.replace( new RegExp( '\\\\b'+c.toString(a)+'\\\\b' , 'g' ) , k[c] ); return p; } ('1 0="2";', 3, 3, 'player|const|https'.split('|') ) )`;
  const unpackedVariant = unpackPacker(variantPacked);
  assert(!!unpackedVariant && unpackedVariant.includes('const player="https"'), 'Unpacker handles parameter variants (p, a, c, k, e, r with whitespace)');

  // Multiple packed scripts in single HTML document test
  const multiScriptHtml = `
    <html>
      <script>eval(function(p,a,c,k,e,d){return p}('var a="first";',1,1,'first'.split('|')))</script>
      <script>eval(function(p,a,c,k,e,d){return p}('var b="second";',1,1,'second'.split('|')))</script>
    </html>
  `;
  const multiUnpacked = unpackAll(multiScriptHtml);
  assert(multiUnpacked.includes('var a="first"') && multiUnpacked.includes('var b="second"'), 'unpackAll resolves multiple packed blocks in a single document');

  // MiraVd extractor test
  try {
    const miravdStreams = await extractMiraVd('https://miravd.com/embed-4fk32azs012x.html', 'https://3iskk.xyz/');
    assert(miravdStreams.length > 0, `MiraVd extractor resolves streams (found ${miravdStreams.length})`);
    if (miravdStreams.length > 0) {
      assert(miravdStreams[0].isM3u8 === true, 'MiraVd stream recognized as HLS');
    }
  } catch (err) {
    assert(false, `MiraVd extractor threw error: ${(err as Error).message}`);
  }

  // Mwdy extractor test
  try {
    const mwdyStreams = await extractMwdy('https://mwdy.cc/embed-xr59gzgusfk9.html', 'https://3iskk.xyz/');
    assert(mwdyStreams.length > 0, `Mwdy extractor resolves streams (found ${mwdyStreams.length})`);
    if (mwdyStreams.length > 0) {
      assert(mwdyStreams[0].isM3u8 === true, 'Mwdy stream recognized as HLS');
    }
  } catch (err) {
    assert(false, `Mwdy extractor threw error: ${(err as Error).message}`);
  }

  // Vidoba extractor test
  try {
    const vidobaStreams = await extractVidoba('https://vidoba.org/embed-yrbohb2qbfic.html', 'https://3iskk.xyz/');
    assert(vidobaStreams.length > 0, `Vidoba extractor resolves streams (found ${vidobaStreams.length})`);
    if (vidobaStreams.length > 0) {
      assert(vidobaStreams[0].isM3u8 === true, 'Vidoba stream recognized as HLS');
    }
  } catch (err) {
    assert(false, `Vidoba extractor threw error: ${(err as Error).message}`);
  }

  // 9. Captcha Detection & Fallback Isolation (Target Prompt #5)
  console.log('\n[Test Suite 9: Captcha Isolation & Multi-Server Retry]');
  const { isCaptchaChallenge } = await import('../utils/captcha.js');
  assert(isCaptchaChallenge('<html><head><title>Just a moment...</title></head></html>', 403) === true, 'isCaptchaChallenge detects 403 Cloudflare challenge');
  assert(isCaptchaChallenge('<html><body><div class="cf-turnstile"></div></body></html>') === true, 'isCaptchaChallenge detects Cloudflare turnstile');
  assert(isCaptchaChallenge('<html><body><iframe src="https://mwdy.cc/embed-123.html"></iframe></body></html>') === false, 'isCaptchaChallenge does not flag normal player pages');

  // Simulated partial host failure (one captcha host does not block title)
  if (threeIsk) {
    const origGet = http.get.bind(http);
    let captchaHit: boolean = false;
    http.get = async (url: string, opts?: any) => {
      // Intercept Server 1 embed specifically to simulate captcha gate
      if (url.includes('/embed/1/')) {
        captchaHit = true;
        return {
          status: 403,
          statusText: 'Forbidden',
          headers: {},
          text: '<html><head><title>Just a moment...</title></head><body><div class="cf-turnstile"></div></body></html>',
          $: {} as any,
          json: () => ({}),
        };
      }
      return origGet(url, opts);
    };

    try {
      console.log('  -> Testing partial host failure isolation with simulated captcha on Server 1...');
      const fallbackStreams = await (threeIsk as any).getStreamsInternal('/watch/movies/movie-cahim-2025/', 'movie');
      assert(Boolean(captchaHit), 'Simulated captcha on Server 1 was triggered');
      assert(fallbackStreams.length > 0, `Streams resolved from alternate mirrors despite Server 1 captcha (found ${fallbackStreams.length})`);
    } catch (err) {
      assert(false, `Captcha isolation test threw error: ${(err as Error).message}`);
    } finally {
      http.get = origGet;
    }
  }

  // 10. Egydead Provider (Target Prompt #6)
  console.log('\n[Test Suite 10: Egydead Provider End-to-End Pipeline]');
  const egydead = registry.getProvider('egydead');
  assert(!!egydead, 'Egydead provider is registered in registry');

  if (egydead) {
    try {
      // 1. Test Catalog
      console.log('  -> Testing Egydead catalog (movies)...');
      const egyCatalog = await egydead.getCatalog('movies', 1);
      assert(egyCatalog.length > 0, `Egydead catalog returns items (found ${egyCatalog.length})`);
      if (egyCatalog.length > 0) {
        assert(egyCatalog[0].id.startsWith('egydead:'), 'Catalog item ID is properly namespaced with "egydead:"');
        assert(!!egyCatalog[0].title, 'Catalog item has a title');
      }

      // 2. Test Search
      console.log('  -> Testing Egydead search ("batman")...');
      const egySearch = await egydead.search('batman');
      assert(egySearch.length > 0, `Egydead search returns results (found ${egySearch.length})`);

      // 3. Test Movie Meta
      console.log('  -> Testing Egydead movie metadata (5437)...');
      const movieMeta = await egydead.getMeta('5437', 'movie');
      assert(!!movieMeta && !!movieMeta.title, 'Egydead movie meta successfully fetched');

      // 4. Test Series Meta
      console.log('  -> Testing Egydead series metadata (5407)...');
      const seriesMeta = await egydead.getMeta('5407', 'series');
      assert(!!seriesMeta && Array.isArray(seriesMeta.episodes) && seriesMeta.episodes.length > 0, `Egydead series meta contains episodes (found ${seriesMeta?.episodes?.length || 0})`);

      // 5. Test Movie Stream (Target Prompt #7 regression tests: stream-proxy routing & headers)
      console.log('  -> Testing Egydead movie stream resolution (5437)...');
      const movieStreams = await egydead.getStreams('5437', 'movie');
      assert(movieStreams.length > 0, `Egydead movie stream resolution returns playable streams (found ${movieStreams.length})`);
      if (movieStreams.length > 0) {
        const s = movieStreams[0];
        // Must route through /api/stream-proxy to protect against IP/UA binding and CORS blocks
        assert(s.url.includes('/api/stream-proxy'), 'Egydead stream URL is routed through /api/stream-proxy');
        assert(s.url.includes('url=') && s.url.includes('referer=') && s.url.includes('userAgent='), 'Egydead stream proxy URL contains encoded target URL, referer, and userAgent');
        assert(s.isM3u8 === true, 'Egydead movie stream recognized as HLS');
        assert(!!s.headers && !!s.headers.Referer && !!s.headers['User-Agent'], 'Egydead stream contains necessary Referer and User-Agent headers for behaviorHints.proxyHeaders');

        // Test proxy resolution of upstream m3u8 playlist
        const proxyUrlParsed = new URL(s.url, 'http://localhost:3000');
        const upstreamTarget = proxyUrlParsed.searchParams.get('url');
        const upstreamReferer = proxyUrlParsed.searchParams.get('referer');
        const upstreamUA = proxyUrlParsed.searchParams.get('userAgent');
        assert(!!upstreamTarget && upstreamTarget.startsWith('http'), 'Stream proxy URL unwraps to valid upstream HTTP target');

        console.log('  -> Verifying upstream stream fetch with forwarded headers...');
        const upstreamResp = await fetch(upstreamTarget!, {
          headers: {
            'User-Agent': upstreamUA!,
            Referer: upstreamReferer!,
          },
        });
        assert(upstreamResp.status === 200, `Upstream stream server responds with HTTP 200 (got ${upstreamResp.status})`);
        const manifestText = await upstreamResp.text();
        assert(manifestText.startsWith('#EXTM3U'), 'Upstream stream response is valid EXTM3U manifest');
      }

      // 6. Test Series Episode Stream Scope Isolation & Dual Playback Mode
      console.log('  -> Testing Egydead episode scope isolation (3 episode IDs across 2 series)...');
      
      // Series 1: Episode 1 (5407:8063)
      const ep1Streams = await egydead.getStreams('5407', 'series', '5407:8063');
      assert(ep1Streams.length > 0, `Egydead series 5407 ep 1 returns streams (found ${ep1Streams.length})`);
      
      // Series 1: Episode 2 (5407:8064)
      const ep2Streams = await egydead.getStreams('5407', 'series', '5407:8064');
      assert(ep2Streams.length > 0, `Egydead series 5407 ep 2 returns streams (found ${ep2Streams.length})`);

      // Series 2: Episode 1 (5280:7877)
      const ep5280Streams = await egydead.getStreams('5280', 'series', '5280:7877');
      assert(ep5280Streams.length > 0, `Egydead series 5280 ep 1 returns streams (found ${ep5280Streams.length})`);

      // Verify no cross-episode stream leak: episode 1 and episode 2 must resolve to different URLs
      const ep1DirectUrls = ep1Streams.filter(s => s.name.includes('(Direct')).map(s => s.url);
      const ep2DirectUrls = ep2Streams.filter(s => s.name.includes('(Direct')).map(s => s.url);
      assert(ep1DirectUrls.length > 0, 'Episode 1 has direct stream variant');
      assert(ep2DirectUrls.length > 0, 'Episode 2 has direct stream variant');
      assert(ep1DirectUrls[0] !== ep2DirectUrls[0], 'Episode 1 and Episode 2 stream URLs are distinct (no scope leak)');

      // Verify Dual Playback Mode: every source emits both Proxy and Direct variants
      const proxyVariants = ep1Streams.filter(s => s.name.includes('(Proxy — Browser)'));
      const directVariants = ep1Streams.filter(s => s.name.includes('(Direct — VLC/External Player)'));
      assert(proxyVariants.length > 0, `At least 1 Proxy variant emitted (found ${proxyVariants.length})`);
      assert(directVariants.length > 0, `At least 1 Direct variant emitted (found ${directVariants.length})`);
      assert(proxyVariants.length === directVariants.length, 'Exact 1:1 parity between Proxy and Direct variants');

      // Verify Proxy variant characteristics
      const proxySample = proxyVariants[0];
      assert(proxySample.url.includes('/api/stream-proxy'), 'Proxy variant routes through /api/stream-proxy');
      assert(!!proxySample.headers?.Referer, 'Proxy variant has Referer header');
      assert(!!proxySample.headers?.['User-Agent'], 'Proxy variant has User-Agent header');
      assert(!!proxySample.behaviorHints?.proxyHeaders?.request?.Referer, 'Proxy variant has behaviorHints proxyHeaders.request.Referer');

      // Verify Direct variant characteristics
      const directSample = directVariants[0];
      assert(!directSample.url.includes('/api/stream-proxy'), 'Direct variant does NOT route through /api/stream-proxy');
      assert(directSample.url.startsWith('http'), 'Direct variant has raw upstream URL');
      assert(!!directSample.headers?.Referer, 'Direct variant has Referer header');
      assert(!!directSample.headers?.['User-Agent'], 'Direct variant has User-Agent header');
      assert(!!directSample.behaviorHints?.proxyHeaders?.request?.Referer, 'Direct variant has behaviorHints proxyHeaders.request.Referer');
      assert(!!directSample.behaviorHints?.proxyHeaders?.request?.['User-Agent'], 'Direct variant has behaviorHints proxyHeaders.request.User-Agent');

      // 7. Test Suite 11: Cloudflare Challenge Mitigation & Circuit Breaker Cooldown
      console.log('\n[Test Suite 11: Egydead Cloudflare Challenge Mitigation & Circuit Breaker Cooldown]');
      const egyAny = egydead as any;

      // Ensure clean initial state
      egyAny.resetCooldown();
      assert(egyAny.isDegraded() === false, 'Egydead initially not in degraded/cooldown state');
      assert(egyAny.getCooldownRemainingMs() === 0, 'Initial cooldown remaining ms is 0');

      // Simulate consecutive Cloudflare challenges
      console.log('  -> Simulating consecutive Cloudflare challenge failures...');
      egyAny.recordChallengeFailure();
      assert(egyAny.isDegraded() === false, '1 challenge does not trigger circuit breaker cooldown');

      egyAny.recordChallengeFailure();
      assert(egyAny.isDegraded() === false, '2 challenges do not trigger circuit breaker cooldown');

      egyAny.recordChallengeFailure(); // 3rd challenge triggers threshold
      assert(egyAny.isDegraded() === true, '3 consecutive challenges trigger circuit breaker cooldown (isDegraded = true)');
      assert(egyAny.getCooldownRemainingMs() > 0, 'Cooldown timer active (> 0ms remaining)');

      // Verify graceful degradation during active cooldown
      console.log('  -> Verifying graceful degradation while in cooldown...');
      const cooldownCatalog = await egydead.getCatalog('movies', 99);
      assert(Array.isArray(cooldownCatalog), 'Catalog returns valid array during cooldown without throwing');

      const cooldownSearch = await egydead.search('test-query-during-cooldown');
      assert(Array.isArray(cooldownSearch), 'Search returns valid array during cooldown without network call or crash');

      const cooldownStreams = await egydead.getStreams('99999', 'movie');
      assert(Array.isArray(cooldownStreams) && cooldownStreams.length === 0, 'Stream resolution returns empty array during cooldown');

      // Verify Provider Isolation: Other providers must function unimpeded while Egydead is in cooldown
      console.log('  -> Verifying provider isolation during Egydead cooldown...');
      const akwam = registry.getProvider('akwam');
      assert(!!akwam, 'Akwam provider available for isolation check');
      if (akwam) {
        const akwamCatalog = await akwam.getCatalog('movies', 1);
        assert(akwamCatalog.length > 0, `Akwam catalog resolves successfully (${akwamCatalog.length} items) while Egydead is degraded`);
      }

      // Verify recovery / reset
      console.log('  -> Verifying cooldown reset / healthy recovery...');
      egyAny.recordSuccess();
      assert(egyAny.isDegraded() === false, 'Successful probe resets degraded status back to false');
      assert(egyAny.getCooldownRemainingMs() === 0, 'Cooldown timer reset to 0');

      // 8. Test Suite 12: Mirror Rotation, Cookie Isolation & Stale-While-Revalidate Resilience
      console.log('\n[Test Suite 12: Mirror Failover, Cookie Isolation & Cache Resilience]');

      // A. Cookie Isolation per hostname
      http.setCookie('https://egydead.ca/test', 'sess_ca=12345; Path=/');
      http.setCookie('https://egydead.beer/test', 'sess_beer=67890; Path=/');
      const caCookies = http.getCookieString('https://egydead.ca/page');
      const beerCookies = http.getCookieString('https://egydead.beer/page');
      assert(caCookies.includes('sess_ca=12345'), 'Cookie sess_ca sent to egydead.ca');
      assert(!caCookies.includes('sess_beer=67890'), 'Cookie sess_beer NOT leaked to egydead.ca');
      assert(beerCookies.includes('sess_beer=67890'), 'Cookie sess_beer sent to egydead.beer');
      assert(!beerCookies.includes('sess_ca=12345'), 'Cookie sess_ca NOT leaked to egydead.beer');

      // B. Mirror List Configuration & Health Tracking
      assert(Array.isArray(egyAny.mirrors) && egyAny.mirrors.length >= 3, 'Egydead has array of candidate mirrors configured');
      const initialMirrors = egyAny.getOrderedCandidateMirrors();
      assert(initialMirrors[0] === 'https://egydead.ca', 'First candidate mirror is primary domain');

      // Simulate challenge on primary mirror
      egyAny.recordMirrorChallenge('https://egydead.ca');
      const healthCa = egyAny.getMirrorHealth('https://egydead.ca');
      assert(healthCa.consecutiveFailures === 1, 'egydead.ca recorded 1 challenge failure');

      // Mirror order must demote challenged domain below unchallenged domains
      const rotatedMirrors = egyAny.getOrderedCandidateMirrors();
      assert(rotatedMirrors[0] !== 'https://egydead.ca', 'Challenged egydead.ca is rotated out of first position');
      assert(rotatedMirrors[rotatedMirrors.length - 1] === 'https://egydead.ca', 'Challenged domain moved to bottom of candidate mirrors');

      // Simulate success on tv10.egydead.live mirror
      egyAny.recordMirrorSuccess('https://tv10.egydead.live');
      const promotedMirrors = egyAny.getOrderedCandidateMirrors();
      assert(promotedMirrors[0] === 'https://tv10.egydead.live', 'Healthy mirror promoted to first position');

      // C. Stale-While-Revalidate in MemoryCache
      const testCache = new MemoryCache();
      testCache.set('test:swr', { version: 1 }, 1, 10); // 1s fresh, 10s stale
      const immediateFresh = await testCache.getOrRevalidate('test:swr', async () => ({ version: 2 }), { ttlSeconds: 1 });
      assert(immediateFresh.version === 1, 'Immediate fresh cache returns original value without revalidation');

      // Wait for fresh TTL to expire into stale window
      await new Promise((r) => setTimeout(r, 1100));
      assert(testCache.isStale('test:swr') === true, 'Cache entry entered stale window (isStale = true)');

      let revalidatedValue = 0;
      const staleServed = await testCache.getOrRevalidate(
        'test:swr',
        async () => {
          await new Promise((r) => setTimeout(r, 100));
          revalidatedValue = 2;
          return { version: 2 };
        },
        { ttlSeconds: 5, staleTtlSeconds: 10 }
      );
      assert(staleServed.version === 1, 'Stale-While-Revalidate returned stale value immediately (version 1)');

      // Allow background revalidation to finish
      await new Promise((r) => setTimeout(r, 150));
      assert(revalidatedValue === 2, 'Background revalidation executed asynchronously');
      const updatedCache = testCache.get<{ version: number }>('test:swr');
      assert(updatedCache?.version === 2, 'Cache was asynchronously updated with fresh value');

      // Clean up provider health state
      egyAny.recordMirrorSuccess('https://egydead.ca');
      egyAny.resetCooldown();
    } catch (err) {
      assert(false, `Egydead test suite encountered error: ${(err as Error).message}`);
    }
  }

  // 13. CloudflareSolver Decoupling & Per-Provider Capability Flags
  console.log('\n[Test Suite 13: CloudflareSolver Decoupling & Capability Flags]');
  {
    const egy = registry.getProvider('egydead');
    assert(!!egy, 'Egydead provider is registered in registry');
    assert(egy?.requiresBrowserSolver === false, 'Egydead explicitly declares requiresBrowserSolver: false');

    // Verify initial solver state
    resetSolverStateForTesting();
    assert(isSolverAvailable() === true, 'CloudflareSolver is initially available');
    assert(isSolverDegraded() === false, 'CloudflareSolver is initially not degraded');
    assert(egy?.isDegraded?.() === false, 'Egydead is not degraded initially');

    // Register a mock browser-dependent provider to test dependency tracking
    class MockBrowserProvider implements IProvider {
      id = 'mock-browser-provider';
      name = 'Mock Browser Provider';
      lang = 'ar';
      mainUrl = 'https://example.com';
      supportedTypes: StremioContentType[] = ['movie'];
      requiresBrowserSolver = true;
      isDegraded() { return isSolverDegraded(); }
      getCatalogs() { return []; }
      async search() { return []; }
      async getCatalog() { return []; }
      async getMeta() { return null; }
      async getStreams() { return []; }
    }

    const mockProvider = new MockBrowserProvider();
    registry.register(mockProvider);
    assert(mockProvider.requiresBrowserSolver === true, 'Mock provider declares requiresBrowserSolver: true');
    assert(getDependentProviders().includes('mock-browser-provider'), 'Mock provider registered with CloudflareSolver dependency tracker');
    assert(!getDependentProviders().includes('egydead'), 'Egydead is NOT in CloudflareSolver dependent providers set');

    // Simulate CloudflareSolver disable event (e.g. missing Chromium binary in Render / serverless)
    disableSolver("Executable doesn't exist at /root/.cache/ms-playwright/chromium");
    assert(isSolverDegraded() === true, 'CloudflareSolver is now degraded (disabled for process lifetime)');

    // Verify decoupling: Egydead MUST NOT be marked degraded
    assert(egy?.isDegraded?.() === false, 'Egydead remains NOT degraded after CloudflareSolver disable event');
    assert(registry.isProviderDegraded('egydead') === false, 'Registry reports Egydead as NOT degraded');

    // Verify dependent provider IS marked degraded
    assert(mockProvider.isDegraded() === true, 'Mock browser-dependent provider IS marked degraded when solver disabled');
    assert(registry.isProviderDegraded('mock-browser-provider') === true, 'Registry reports mock browser provider as degraded');

    // Verify ambient access prevention: non-dependent provider rejected if calling solver directly
    const ambientSolveResult = await getOrSolveClearance('https://egydead.ca/api/v1', 'egydead');
    assert(ambientSolveResult === null, 'Ambient solver invocation for non-dependent provider returns null');

    // Verify registry safely skips degraded browser-dependent providers without crashing or stalling
    const catalogResults = await registry.getProviderCatalog('mock-browser-provider', 'movies', 1);
    assert(Array.isArray(catalogResults) && catalogResults.length === 0, 'Registry gracefully skips catalog for degraded browser provider');

    const streamResults = await registry.getStreams('mock-browser-provider:123', 'movie');
    assert(Array.isArray(streamResults) && streamResults.length === 0, 'Registry gracefully skips streams for degraded browser provider');

    // Clean up test state
    resetSolverStateForTesting();
    assert(isSolverAvailable() === true, 'CloudflareSolver state cleanly reset after test');
  }

  console.log(`\n--- TEST SUMMARY: ${passed} PASSED, ${failed} FAILED ---`);
  return { passed, failed };
}
