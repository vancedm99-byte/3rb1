# Project Status: CloudStream `re-3arabi` to Stremio Addon Migration

**Last Updated:** 2026-09-12 21:15:00 UTC  
**Project Identifier:** `community.re3arabi.addon` / Re-3arabi Stremio Addon  
**Maintainer / Author Context:** CloudStream Arabic Extensions (`re-3arabi`) Porting Project

---

## 1. Project Goal

The primary objective of this project is to convert the Arabic streaming and Live TV provider ecosystem from the Android Kotlin CloudStream repository (`re-3arabi`) into a standalone, production-ready, containerized Node.js / TypeScript Stremio v3 Addon server. The addon aggregates Arabic video-on-demand content (Arabic & foreign movies, TV series, Japanese anime with Arabic subtitles/dubbing, and Turkish dramas) along with 24/7 Live TV channels and real-time football match streams. It exposes the official Stremio Addon protocol endpoints (`/manifest.json`, `/catalog`, `/meta`, `/stream`) backed by direct HLS/m3u8 stream resolution, cryptographic deobfuscation, and a companion web testing dashboard.

---

## 2. Source CloudStream Providers & Original Repository Structure

The source repository `re-3arabi/` contains Android Kotlin extensions using CloudStream's `MainAPI`, `ExtractorApi`, and plugin architecture.

### Source Files Inventory (`re-3arabi/`):
| Source Provider Folder | Key Original Kotlin Files | Original Purpose | Porting Status |
|---|---|---|---|
| `re-3arabi/Akwam` | `Akwam.kt`, `AkwamPlugin.kt` | Movies and TV Series scraper | **Ported** (`src/providers/akwam/`) |
| `re-3arabi/Arabseed` | `Arabseed.kt`, `ArabseedProvider.kt`, `CloudflareSolver.kt`, `GameHubExtractor.kt` | Arabic/Foreign movies & series | **Ported** (`src/providers/arabseed/`) |
| `re-3arabi/3isk` | `eishk.kt`, `eishkPlugin.kt` | Turkish dramas & episodes | **Ported** (`src/providers/3isk/`) |
| `re-3arabi/Anime4up` | `anime4up.kt`, `anime4upPlugin.kt`, `CloudflareSolver.kt` | Anime scraper with mirror hosts | **Ported** (`src/providers/anime4up/`) |
| `re-3arabi/Anim3rb` | `anim3rbProvider.kt`, `anim3rbPlugin.kt`, `Anime3rbSettings.kt` | Anime episodes and movies | Pending / Backlog |
| `re-3arabi/Animerco` | `Animerco.kt`, `AnimercoPlugin.kt`, `MailruExtractor.kt`, `VideaExtractor.kt`, `ExternalEarnVidsExtractor.kt` | Anime scraper & multi-host extractors | Extractors ported; Provider pending |
| `re-3arabi/Anime-Phoenix` | `Phoenix.kt`, `PhoenixPlugin.kt` | Anime episodes | Pending / Backlog |
| `re-3arabi/Animewitcher` | `animewitcher.kt`, `animewitcherPlugin.kt` | Anime series and movies | Pending / Backlog |
| `re-3arabi/Aflaam` | `aflaam.kt`, `aflaamPlugin.kt` | Arabic movies & classics | Pending / Backlog |
| `re-3arabi/Alooytv` | `alooy.kt`, `alooyPlugin.kt` | Gulf, Egyptian & Arabic drama | Pending / Backlog |
| `re-3arabi/Aia2tv 2` | `Asia2tv.kt`, `Asia2tvPlugin.kt` | Asian drama (Korean, Japanese, Chinese) with Arabic subs | Pending / Backlog |
| `re-3arabi/Bristege` | `bristegProvider.kt`, `bristegPlugin.kt` | Arabic Ramadan and exclusive drama | Pending / Backlog |
| `re-3arabi/Cee` | `Cee.kt`, `CeePlugin.kt` | Arabic series and movie streaming | Pending / Backlog |
| `re-3arabi/CimaClub` | `CimaClubPlugin.kt` | Arabic and international streaming | Pending / Backlog |

### Additional Ecosystem Providers Included:
- **Yacine TV:** Ported from Android APK network layer (`def.ycnapi.com`) with full XOR decryption for live channels and football matches.
- **SyriaLive:** Ported from `syrlive.com` / sports schedule feed for real-time match fixtures and live player streams.
- **FaselHD:** Ported from `faselhd.pro` / `fasel-hd.co` for movies, series, and dedicated anime catalogs.
- **We Cima (MyCima):** Ported from `mycima.motorcycles` with Base64 URL decoding and unpacked HLS stream resolution.
- **WitAnime:** Ported from `witanime.pics` with dual-buffer byte XOR deobfuscation.
- **Egydead:** Ported from `egydead.beer` with watch page form dispatch and Turnstile isolation.

---

## 3. Target Stremio Addon Files Created

All target code is written in modern TypeScript (ESM) with Node.js and React:

| File Path | One-Line Purpose |
|---|---|
| `server.ts` | Express server binding port 3000, serving Stremio protocol routes, REST APIs, stream proxy, and Vite client. |
| `src/addon/manifest.ts` | Stremio v3 Addon manifest defining metadata, catalogs (`movie`, `series`, `anime`, `tv`), ID prefixes, and types. |
| `src/addon/router.ts` | Express router implementing Stremio protocol endpoints (`/manifest.json`, `/catalog`, `/meta`, `/stream`). |
| `src/types/stremio.ts` | TypeScript types for Stremio Manifest, Catalogs, Metas, Episodes, Streams, and BehaviorHints. |
| `src/types/provider.ts` | TypeScript interfaces for `IProvider`, `ProviderItem`, `ProviderDetail`, and `ResolvedStream`. |
| `src/providers/base.ts` | Abstract base provider class with integrated TTL caching, namespaced ID parsing, and logger setup. |
| `src/providers/index.ts` | Provider registry managing provider registration, parallel multi-search, catalog aggregation, and ID routing. |
| `src/providers/akwam/index.ts` | Akwam provider scraping movies and series with direct quality stream link extraction. |
| `src/providers/faselhd/index.ts` | FaselHD provider supporting movies, series, and anime with multi-server embed resolution. |
| `src/providers/arabseed/index.ts` | Arabseed provider for movies and series with watch page and server embed resolution. |
| `src/providers/wecima/index.ts` | We Cima scraper resolving active mirrors (`mycima.motorcycles`) and extracting packed HLS streams. |
| `src/providers/anime4up/index.ts` | Anime4up anime scraper parsing episodes and extracting video hosting mirrors. |
| `src/providers/witanime/index.ts` | WitAnime provider utilizing dual-buffer byte XOR deobfuscation for episode streams. |
| `src/providers/3isk/index.ts` | 3isk Turkish drama scraper with 2-stage POST token handshake and Dean Edwards unpacking. |
| `src/providers/egydead/index.ts` | Egydead provider with dynamic watch view POST handling and Cloudflare Turnstile error isolation. |
| `src/providers/syrialive/index.ts` | SyriaLive provider fetching real-time match fixtures, tournament schedules, and direct HLS streams. |
| `src/providers/yacinetv/index.ts` | Yacine TV provider implementing XOR API decryption for 90+ live channels and daily live match events. |
| `src/extractors/index.ts` | Master extractor router resolving direct links, embedded players, Dean Edwards scripts, and specialized video hosts. |
| `src/extractors/earnvids.ts` | Dedicated extractor for EarnVids, StreamHG, and related video hosting platforms. |
| `src/extractors/share4max.ts` | Dedicated extractor for Share4max, Megamax, and Inertia.js video players. |
| `src/extractors/mailru.ts` | Mail.ru video metadata and stream resolver. |
| `src/extractors/videa.ts` | Videa.hu stream extractor with RC4 token decryption. |
| `src/extractors/govid.ts` | Govid.live video player extractor. |
| `src/extractors/ukrcdn.ts` | Ukrcdn video player and HLS m3u8 API stream extractor. |
| `src/extractors/miravd.ts` | Dedicated extractor for MiraVd embeds with Dean Edwards unpacking. |
| `src/extractors/mwdy.ts` | Dedicated extractor for Mwdy embeds with multi-block unpacking. |
| `src/extractors/vidoba.ts` | Dedicated extractor for Vidoba embeds with HLS/MP4 extraction. |
| `src/utils/http.ts` | High-performance fetch wrapper with Cheerio HTML loading, cookie jar, timeout abort, and user-agent emulation. |
| `src/utils/crypto.ts` | Cryptographic routines (YacineTV XOR, WitAnime dual-buffer XOR, RC4 decryption, safe Base64 decode). |
| `src/utils/packer.ts` | Algorithmic Dean Edwards JavaScript unpacker resolving obfuscated `eval(function(p,a,c,k,e,d))` scripts without eval. |
| `src/utils/cache.ts` | In-memory TTL key-value caching module to avoid redundant upstream requests. |
| `src/utils/logger.ts` | Scoped and formatted console logger supporting debug, info, warn, and error levels. |
| `src/tests/addon.test.ts` | Automated test suite verifying manifest compliance, ID parsing, crypto functions, unpacker, cache, and provider isolation. |
| `src/tests/run.ts` | Test runner entry point executing unit and integration assertions. |
| `src/App.tsx` | Full-featured React web dashboard for browsing catalogs, searching titles, inspecting streams, and 1-click Stremio installation. |
| `src/components/Navbar.tsx` | Header navigation bar with status badges, theme controls, and quick links. |
| `src/components/ProviderGrid.tsx` | Visual status grid displaying registered providers, supported types, and active health. |
| `src/components/ContentExplorer.tsx` | Interactive catalog browser and search interface for testing provider responses. |
| `src/components/StreamModal.tsx` | Stream modal with built-in video player, stream URL copier, and proxy inspection. |
| `src/components/SetupGuide.tsx` | Step-by-step Stremio setup guide for desktop, mobile, Android TV, and Web. |
| `package.json` | Dependencies, scripts (`dev`, `build`, `start`, `test`, `lint`), and package metadata. |
| `tsconfig.json` | TypeScript configuration for ES2022/NodeNext modules. |
| `vite.config.ts` | Vite frontend bundling configuration with Tailwind CSS plugin. |
| `metadata.json` | Application metadata specification. |
| `README.md` | Comprehensive project documentation and installation instructions. |

---

## 4. Completed Steps

- [x] **Project Scaffolding & Architecture:** Established Express + Vite unified server on port 3000 supporting both Stremio protocol routes and an interactive testing UI.
- [x] **Stremio Protocol Compliance:** Implemented `/manifest.json`, `/catalog/:type/:id/:extra?.json`, `/meta/:type/:id.json`, and `/stream/:type/:id.json`.
- [x] **ID Namespacing Scheme:** Built bidirectional ID formatting/parsing (`<provider>:<content_path_or_id>`) allowing multiple providers to coexist without ID collision.
- [x] **Cryptographic & Deobfuscation Algorithms:**
  - [x] Dean Edwards JavaScript unpacker without `eval()`.
  - [x] Yacine TV Android XOR cipher (`baseKey + t`).
  - [x] WitAnime dual-buffer byte XOR deobfuscation (`part1 ^ part2`).
  - [x] RC4 token decryption for Videa.
  - [x] URL-safe Base64 padding normalization (including WeCima's `aHR0c` prefix).
- [x] **Video Hosting Extractors:**
  - [x] Direct `.m3u8` and `.mp4` detection.
  - [x] EarnVids / StreamHG extractor.
  - [x] Share4max / Megamax extractor.
  - [x] Mail.ru stream resolver.
  - [x] Videa.hu extractor.
  - [x] Govid.live extractor.
  - [x] Generic HTML5/regex fallback parser.
- [x] **Core Provider Implementations (10 Providers):**
  - [x] **Akwam:** Movies & TV Series with direct quality streams.
  - [x] **FaselHD:** Movies, TV Series, and Japanese Anime catalogs.
  - [x] **Arabseed:** Movies & Series with watch page embed extraction.
  - [x] **We Cima:** Unblocked mirror (`mycima.motorcycles`) with packed HLS stream extraction.
  - [x] **Anime4up:** Anime catalog and episode server scraper.
  - [x] **WitAnime:** Anime series with dual-buffer XOR decryption.
  - [x] **3isk:** Turkish drama scraper with 2-stage POST token handshake.
  - [x] **Egydead:** Form POST watch dispatcher with Cloudflare Turnstile error isolation.
  - [x] **SyriaLive:** Real-time match fixtures and sports streams.
  - [x] **Yacine TV:** 93 live TV channels + real-time match events with HD/SD/Low m3u8 streams.
- [x] **Stream Proxy & CORS Bypass:** Built `/api/stream-proxy` with upstream header forwarding (`Referer`, `Origin`, `User-Agent`) for browser playback and Stremio Web.
- [x] **Automated Test Suite:** Built unit & integration tests (`npm run test`) validating manifest structure, registry routing, deobfuscation algorithms, in-memory cache, and provider isolation.
- [x] **Interactive Web Dashboard:** Built modern responsive dashboard for previewing catalogs, testing live streams, and 1-click Stremio installation.
- [x] **Per-Provider `type` Restructuring for Stremio Discover UI (Target Prompt #2):**
  - [x] **Dynamic Manifest Generation:** Refactored `src/addon/manifest.ts` using `buildManifest()` to programmatically iterate over `ProviderRegistry.getAllProviders()` and generate custom types and catalogs dynamically.
  - [x] **Stremio Discover UI Dropdown Hierarchy:**
    - Dropdown 1 (Type): Exposes each provider (e.g. Akwam, FaselHD, Arabseed, We Cima, Anime4up, WitAnime, 3isk, Egydead, SyriaLive, Yacine TV).
    - Dropdown 2 (Catalog): Exposes provider-specific catalogs (e.g., Movies, Series for VOD providers; Live Channels and Live Matches for Yacine TV and SyriaLive).
    - Dropdown 3 (Extra/Genre): Exposes each provider+catalog's supported genre options (e.g., Action, Drama, Turkish, Ramadan 2026, tournaments, etc.).
  - [x] **Genre-Aware Catalog Routing in All Providers:** Implemented `getCatalogs()` and updated `getCatalogInternal(catalogId, page, genre)` across all 10 providers.
  - [x] **Provider Catalog Router:** Refactored `src/addon/router.ts` `handleCatalog` to resolve providers by type, parse catalog IDs, extract `genre` from path/query, and route requests directly to provider catalog methods with global search fallback.
  - [x] **Namespacing & Stream Resolution Preserved:** Maintained `<provider>:<content_path_or_id>` ID scheme for seamless `/meta` and `/stream` resolution without breaking existing clients.
  - [x] **Comprehensive Test Coverage:** Updated `src/tests/addon.test.ts` to assert per-provider manifest types, catalog genres, and registry execution (30/30 tests passing).
- [x] **3isk Stream Resolution & 2-Stage Handshake Fix (Target Prompt #3):**
  - [x] **Isolated Failure Points:**
    - Root Cause 1: Domain mismatch (`3esk.onl` redirects to `3iskk.xyz`) caused `epHref.replace(this.mainUrl, '')` to leave the `https:` protocol intact, resulting in fragmented IDs during `split(':')` in the stream handler.
    - Root Cause 2: The watch page form was missing button submit payload (`submit=submit`) and `Origin` / `Referer` headers required by live 3isk handshake endpoint `aa.3isk.icu`.
    - Root Cause 3: The embed response links to multi-server endpoints (`/embed/{1..5}/...`) that contain nested iframes (`miravd`, `mwdy`, `vidoba`) or `ukrcdn.club` rather than packed scripts on the embed page wrapper itself.
    - Root Cause 4: Movie catalog selector in `3isk/index.ts` only matched `/serie-` and `/tvshows/`, omitting `/movies/` and `li.type_item_box`.
  - [x] **Implemented Fixes:**
    - Upgraded `mainUrl` to active domain `https://3iskk.xyz` and introduced `cleanPath()` to sanitize URLs to relative paths (`/watch/episodes/...`, `/watch/movies/...`).
    - Fixed 2-stage handshake payload in `src/providers/3isk/index.ts` to pass `news`, `u`, and `submit` with `Referer` and `Origin` headers.
    - Implemented multi-server probe across candidate embed servers 1 through 5.
    - Created dedicated `src/extractors/ukrcdn.ts` to handle ukrcdn playback API requests (`/api/videos/.../playback?g=...`) with JSON token extraction.
    - Integrated nested iframe unpacking via `extractStreams` and Dean Edwards `unpackAll()`, resolving HLS `.m3u8` master playlists with unescaped slashes.
    - Added regression test suite in `src/tests/addon.test.ts` validating movie and episode stream resolution (37/37 tests passing).
- [x] **Dedicated 3isk Host Extractors & Unpacker Enhancement (Target Prompt #4):**
  - [x] Built modular extractors for `miravd.com` (`src/extractors/miravd.ts`), `mwdy.cc` (`src/extractors/mwdy.ts`), and `vidoba.org` (`src/extractors/vidoba.ts`).
  - [x] Enhanced `src/utils/packer.ts` with whitespace normalization and multi-block unpacking (`unpackAll()`).
  - [x] Tested across sample set of Turkish movies and series (46/46 tests passing).
- [x] **Recovery of "No-Token" Titles & Per-Host Captcha Isolation (Target Prompt #5):**
  - [x] **Multi-Server Retry for "No-Token" Titles:** When Stage 1 handshake fails or returns no `myUrl`/`news` token, the provider extracts the post ID (`comment_post_ID` or meta/regex) and probes mirror servers 1–5 (`/embed/{1..5}/:postId/{1..2}/`).
  - [x] **Recovered Working Titles:** Verified that titles previously classified as pending/no-token (e.g. `movie-cahim-2025`) successfully resolve playable HLS streams across mirrors 1 and 2 (`mwdy.cc` and `miravd.com`).
  - [x] **Accurate Upstream Unavailability Confirmation:** Titles where all mirror servers fail or return 404 (e.g. `movie-leila-2026`, which is 404 upstream) are logged with server-by-server reasons and return `[]` gracefully without crashing.
  - [x] **Per-Host Captcha Isolation:** Built `src/utils/captcha.ts` to detect Cloudflare Turnstile and challenge pages. When a specific mirror server encounters a captcha challenge, that host is isolated and skipped, allowing remaining sibling mirror hosts to resolve streams.
  - [x] **Comprehensive Test Suite:** Extended `src/tests/addon.test.ts` with Test Suite 9 covering captcha detection, no-token recovery, and partial-host-failure simulation (52/52 tests passing).

---

## 5. In-Progress / Partially Implemented Components

- [ ] **Upstream Domain Watcher & Auto-Fallback:**
  - *Current State:* Domain URLs are statically configured or use known active mirrors (e.g. `mycima.motorcycles`, `akwam.to`, `faselhd.pro`).
  - *Missing:* Dynamic domain resolution via DNS-over-HTTPS or fallback mirror arrays when primary domains get blocked by ISPs.
- [ ] **Turnstile Challenge Resolution for Headless Environments:**
  - *Current State:* Egydead and some Anime4up mirrors encounter Cloudflare Turnstile; code isolates these failures gracefully without crashing.
  - *Missing:* A server-side solver or headless cookie forwarder for sites with aggressive bot protection.
- [ ] **Pagination Aggregation in Stremio Catalogs:**
  - *Current State:* Single-provider catalogs support pagination; aggregated catalogs slice the first page across providers to maintain fast response times.
  - *Missing:* Deep multi-page interleaving across providers when `skip > 20`.
- [ ] **Subtitle Stream Formatting:**
  - *Current State:* Embedded subtitles inside HLS streams play natively; Arabic hardsubs are common.
  - *Missing:* External `.vtt` / `.srt` tracks extracted from providers (e.g. FaselHD, Akwam) are not yet exposed as Stremio `subtitles` resource objects in the manifest.

---

## 6. Not-Yet-Started Components

- [ ] **Remaining CloudStream `re-3arabi` Providers:**
  - [ ] `Aflaam` (Arabic movie catalog)
  - [ ] `Alooytv` (Gulf and Arabic television series)
  - [ ] `Aia2tv 2` (Asia2tv - Asian drama series with Arabic subtitles)
  - [ ] `Anim3rb` (Anime 3rb provider)
  - [ ] `Animerco` (Anime Erco provider)
  - [ ] `Anime-Phoenix` (Phoenix anime provider)
  - [ ] `Animewitcher` (Anime Witcher provider)
  - [ ] `Bristege` (Prestige drama provider)
  - [ ] `Cee` (Cee drama provider)
  - [ ] `CimaClub` (CimaClub movies and series)
- [ ] **IMDB / TMDB / Cinemeta Metadata Mapping:**
  - Enabling Stremio library synchronization so that clicking a movie/series in Stremio's default catalog can query Re-3arabi streams using IMDB ID (`tt...`).
- [ ] **Stremio Subtitles Resource (`subtitles`):**
  - Declaring `subtitles` resource in `manifest.ts` and implementing `/subtitles/:type/:id.json`.
- [ ] **Custom Addon Configuration Page (`/configure`):**
  - Allowing users to select which providers to enable/disable or filter preferred qualities before generating their personalized `stremio://...` manifest URL.

---

## 7. Key Technical Decisions Made

1. **Standalone Architecture (No Heavy Frameworks or Unmaintained Addon SDKs):**
   - Built directly on standard Express 4 + TypeScript ESM, avoiding outdated `stremio-addon-sdk` dependencies. This provides full control over CORS headers, routing, bundling, and stream proxies.
2. **Centralized HTTP Engine with Cheerio:**
   - Created `HttpClient` wrapping Node.js `fetch` with integrated Cheerio DOM parsing, AbortController timeouts, automatic cookie jar persistence, and desktop/mobile user-agent rotation.
3. **Pure Algorithmic Unpacking & Decryption:**
   - Dean Edwards script unpacker runs without `eval()` using token replacement regexes to ensure safe server execution.
   - XOR ciphers and RC4 are implemented using Node's `crypto` and `Buffer` byte arithmetic, matching original Android Kotlin implementations byte-for-byte.
4. **Resilient Provider Isolation:**
   - Each provider runs inside individual try/catch boundaries within the `ProviderRegistry`. If one provider encounters a 403, 503, or DNS failure, other providers continue serving catalogs and search results without interruption.
5. **Two-Tier Caching Strategy:**
   - In-memory TTL cache (`MemoryCache`) caches search results (3 min), catalogs (5 min), metadata (10 min), and streams (3 min) to minimize load on upstream servers and speed up Stremio UI response times.
6. **Built-in Stream Proxy:**
   - `/api/stream-proxy` handles upstream `Referer`, `Origin`, and `User-Agent` headers for streams protected by hotlink guards, ensuring compatibility with web browsers and Stremio Web.

---

## 8. Known Issues, Blockers, & Unresolved Edge Cases

### 3isk Stream Resolution Host & Pattern Support Matrix (Target Prompts #4 & #5)
* **No-Token Recovery & Multi-Server Probe:** When the 2-stage handshake returns a fallback page with no next token, the provider extracts the post ID (`comment_post_ID` or meta/slug) and systematically probes mirror servers 1–5 (`/embed/{1..5}/:postId/{1..2}/`). This recovered titles like `movie-cahim-2025` (resolving HLS streams from `mwdy.cc` and `miravd.com`).
* **Upstream Unavailability Confirmation:** Titles that 404 or fail across all mirrors (e.g. `movie-leila-2026`, confirmed 404 upstream) are logged with individual mirror reasons and return `[]` gracefully without errors.
* **Per-Host Captcha Isolation:** When a third-party embed host or mirror serves a Cloudflare Turnstile/hCaptcha challenge (detected via `src/utils/captcha.ts`), that host is isolated and skipped so sibling mirror hosts continue resolving.

| Host / Embed Pattern | Status | Extractor Module | Notes |
|---|---|---|---|
| `ukrcdn.club` / `ukrcdn.xyz` (`/e/:id`) | **Supported** | `src/extractors/ukrcdn.ts` | Server 1 on many titles; resolves direct HLS master playlist via upstream API. |
| `miravd.com` (`/embed-*.html`) | **Supported** | `src/extractors/miravd.ts` | Server 1/mirror host; uses Dean Edwards packed JS containing HLS/MP4 streams. |
| `mwdy.cc` / `mwdy.club` (`/embed-*.html`) | **Supported** | `src/extractors/mwdy.ts` | Server 2/mirror host; uses packed JS containing HLS master playlists. |
| `vidoba.org` (`/embed-*.html`) | **Supported** | `src/extractors/vidoba.ts` | Server 3/mirror host; resolves packed HLS/MP4 stream URLs. |
| `3iskk.xyz/embed/:server/:postId/:part/` | **Supported** | `src/providers/3isk/index.ts` | Multi-server retry probes mirrors 1–5 when handshake yields no token. |
| `aa.3isk.icu/embed/:server/:id/` | **Supported** | `src/providers/3isk/index.ts` | Probed across mirror servers 1–5; routes to modular extractors. |
| `govid.live` / generic iframe | **Supported** | `src/extractors/index.ts` | Generic fallback parser inspecting iframes and HTML video tags. |
| Captcha-gated third-party hosts (e.g. Turnstile) | **Isolated (Per-Host Fallback)** | `src/utils/captcha.ts` | Isolated on per-host basis; skipped to allow sibling mirrors to resolve without title failure. |

### Egydead Provider Diagnosis & Operational Fix (Target Prompt #6 & #7)
* **Root Cause Diagnosis (Prompt #6 - Catalog & Metadata Pipeline):**
  1. **Domain Rotation & Global Turnstile Block:** The legacy hardcoded domain `egydead.beer` redirected to `tv10.egydead.live`. Both `tv10.egydead.live` and `egydead.live` were completely gated by Cloudflare Turnstile (HTTP 403 `Just a moment...`) at the edge, blocking catalog, metadata, and watch pages entirely.
  2. **Architecture Transition to MTDb:** Egydead migrated its active, non-Turnstile-gated deployment to `https://egydead.ca`, running an MTDb media database with structured REST APIs (`/api/v1/channel/*`, `/api/v1/search/*`, `/api/v1/titles/*`, `/api/v1/videos/*`).
  3. **Referer Header Requirement:** The MTDb API requires `Referer: https://egydead.ca/` to return full JSON channel and video payloads.
* **Root Cause Diagnosis (Prompt #7 - Stream Playback Failure):**
  1. **User-Agent & IP Cryptographic Binding:** The primary video stream host (`s1.egybestvid.com`) generates signed HLS URL tokens (`?t=...&s=...&e=50400&v=...&i=0.3&sp=0`, 14-hour token validity window) cryptographically bound to the server's public IP and `User-Agent`. When external players (Stremio desktop, mobile players, web browsers) attempt direct playback, requests originate from the user's IP and send player-specific User-Agents (e.g. ExoPlayer, VLC, Mozilla/iPhone), immediately triggering `HTTP 403 Forbidden`.
  2. **Missing Stream Proxy Routing:** Egydead streams were initially returned as raw upstream URLs (`https://s1.egybestvid.com/...`), completely bypassing the `/api/stream-proxy` routing mechanism built to protect hotlink-guarded streams.
  3. **Nested Manifest Chunk Protection (Child Playlist & TS Segment Bypasses):** The upstream `master.m3u8` contains absolute URLs to variant playlists (`index-v1-a1.m3u8`), which in turn contain absolute URLs to `.ts` video chunks (`seg-*.ts`). Simply proxying the master URL is insufficient because the video player makes direct requests to the inner variant and segment URLs, causing playback to crash on the first chunk with HTTP 403.
  4. **Locale Token Fingerprinting (`Accept-Language`):** Embed host `egybestvid.com` incorporates the `Accept-Language` header into the token if sent during the scrape. When default scraper headers included Arabic locale, subsequent player requests lacking this exact locale were rejected with 403. Suppressing `Accept-Language` during embed inspection prevents language hash binding.
* **Resolution Implemented:**
  - **Provider-Level Stream Proxy Routing:** Updated `src/providers/egydead/index.ts` to wrap all resolved streams in `/api/stream-proxy?url=...&referer=...&userAgent=...` and set `headers: { Referer: embed.src, 'User-Agent': DEFAULT_USER_AGENT }`.
  - **Router Absolute URL Resolution:** Updated `src/addon/router.ts` to resolve relative stream proxy URLs into fully qualified absolute URLs (`${baseUrl}${s.url}`) using request headers, ensuring external Stremio clients on Android TV, Mobile, and Desktop can stream seamlessly.
  - **Recursive HLS Manifest Rewriting in `/api/stream-proxy`:** Enhanced `server.ts` to intercept `.m3u8` manifests and rewrite all child playlist, key (`#EXT-X-KEY`), and segment URIs to route recursively through `/api/stream-proxy` while preserving upstream headers (`User-Agent`, `Referer`, `Origin`, and `Range`).
  - **Browser Preview Player HLS Engine:** Integrated `hls.js` in `src/components/StreamModal.tsx` to enable seamless in-browser playback of HLS proxy streams within the AI Studio dashboard.
  - **Full Regression Verification:** Added comprehensive regression tests in `src/tests/addon.test.ts` verifying proxy routing, header forwarding, upstream HTTP 200 responses, and full 3-tier playback (master, variant, TS segment) with 70/70 tests passing.

* **Root Cause Diagnosis (Prompt #8 - Decoupling CloudflareSolver from Egydead Catalog Pipeline & Evidence-Based Health Check):**
  1. **Evidence-Based Domain Health Probe (Live Status of 4 Mirrors):**
     - `https://egydead.ca/api/v1/channel/movies?page=1`: **HTTP 200 OK**, Content-Type `application/json`, serving clean JSON with zero Turnstile challenge.
     - `https://egydead.live/api/v1/channel/movies?page=1`: **HTTP 403 Forbidden**, serving Cloudflare Turnstile challenge page (`Just a moment...`).
     - `https://tv10.egydead.live/api/v1/channel/movies?page=1`: **HTTP 403 Forbidden**, serving Cloudflare Turnstile challenge page (`Just a moment...`).
     - `https://egydead.beer/api/v1/channel/movies?page=1`: **HTTP 403 Forbidden**, serving Cloudflare Turnstile challenge page (`Just a moment...`).
  2. **Unintended Ambient Browser Dependency on Gated Secondary Mirrors:**
     - `egydead.ca` is healthy and never needed a browser solver. However, when secondary/legacy mirrors returned 403 Turnstile challenges, `requestWithRetry` silently fell through to `getOrSolveClearance()`.
     - In serverless/container environments like Render's native Node runtime (where OS-level Chromium dependencies are absent), `CloudflareSolver` failed with an executable launch error and permanently disabled itself for the process lifetime (`chromiumUnavailable = true`).
     - The challenge failures across secondary mirrors then accumulated, tripping Egydead's 10-minute circuit breaker cooldown even though its active API host (`egydead.ca`) was completely healthy.
  3. **Resolution Implemented:**
     - **Per-Provider Capability Flag (`requiresBrowserSolver`):** Added `requiresBrowserSolver?: boolean` to `IProvider` (default `false` in `BaseProvider`), explicitly declared as `requiresBrowserSolver: false` in `EgydeadProvider`.
     - **Ambient Solver Call Elimination:** Guarded `getOrSolveClearance()` in `EgydeadProvider.requestWithRetry()` so non-browser providers never attempt browser challenge solving or fall through to `CloudflareSolver`.
     - **CloudflareSolver Scoped Degradation & Dependency Registry:** Refactored `src/utils/cloudflareSolver.ts` to maintain an explicit set of registered dependent providers (`registerBrowserSolverDependency`). When a launch failure occurs, the disable event only marks *itself and explicitly dependent providers* as degraded, and logs a single clear WARN listing the affected providers (`Affected dependent providers marked as degraded: [...]` or `0 affected`). Ambient solver calls from unlisted providers are rejected.
     - **Registry-Level Degraded Handling:** Enhanced `ProviderRegistry` to track degraded status per provider, automatically skipping only providers requiring the browser solver when degraded, preserving full provider isolation and preventing any ripple effect on non-browser providers.
     - **Full Test Coverage:** Added Test Suite 13 in `src/tests/addon.test.ts` verifying solver state transitions, capability flags, dependency tracking, ambient call rejection, and isolated degradation across 131 passing assertions.

| General Issue / Edge Case | Description | Mitigation / Current Behavior |
|---|---|---|
| **Egydead Stream Host IP/UA Binding** | `s1.egybestvid.com` binds tokens to IP and User-Agent; direct playback returns HTTP 403. | Stream URLs are routed through `/api/stream-proxy`; master & variant playlists are rewritten to proxy all segments; headers forwarded to Stremio `behaviorHints.proxyHeaders`. |
| **Frequent Domain Rotation** | Arabic streaming sites change their TLDs frequently due to DMCA/ISP blocks. | Active domains are tested and updated (e.g., WeCima to `mycima.motorcycles`, Egydead to `egydead.ca`); fallback mirror lists implemented. |
| **Cloudflare Turnstile (Legacy Egydead Mirrors) & Solver Decoupling** | Legacy mirrors (`egydead.live`, `tv10.egydead.live`, `egydead.beer`) serve Cloudflare Turnstile (HTTP 403), while `egydead.ca` is 100% healthy (HTTP 200). Missing Chromium on host would disable `CloudflareSolver`. | `EgydeadProvider` sets `requiresBrowserSolver: false`, decoupling it from `CloudflareSolver`. Browser solver disable events only degrade providers declaring an explicit browser dependency; ambient access is rejected. |
| **Live Sports Stream Expiration** | YacineTV match streams use short-lived timestamp tokens (`?t=...&e=...`). | Cached streams have a short TTL (3 minutes) to ensure fresh tokens are requested on playback. |
| **Anime4up / WitAnime Geo-Restrictions** | Some anime servers restrict certain IP ranges or rate-limit automated scrapes. | Fallback user agents and headers are applied; FaselHD serves as a high-reliability anime alternative. |

---

## 9. Environment & Configuration Requirements

- **Runtime:** Node.js 18+ or 20+ (Node 22 supported natively).
- **Binding Port:** Port 3000 (`0.0.0.0:3000`), required by container infrastructure.
- **Node Scripts:**
  - `npm run dev`: Boots server via `tsx server.ts`.
  - `npm run build`: Builds Vite frontend into `dist/` and bundles `server.ts` into `dist/server.cjs` via `esbuild`.
  - `npm start`: Starts production bundle via `node dist/server.cjs`.
  - `npm run test`: Executes the test suite via `tsx src/tests/run.ts`.
  - `npm run lint`: Verifies TypeScript types with `tsc --noEmit`.
- **Environment Variables:**
  - No required external API keys for core Stremio addon operation.
  - Optional `GEMINI_API_KEY` defined in `.env.example` for AI Studio capabilities.

---

## 10. Open Questions & Ambiguities

1. **Target Provider Priority for Next Phase:**
   - Should Phase 2 focus on porting the remaining 10 CloudStream providers (`Aflaam`, `Alooytv`, `Asia2tv`, `Anim3rb`, `Bristege`, `Cee`, etc.), OR on IMDB/TMDB ID mapping to integrate directly with Stremio's default Cinemeta catalog?
2. **Subtitles Resource Integration:**
   - Do users require Stremio's native subtitle tracks (`/subtitles` endpoint) for external VTT/SRT files, or are provider-embedded/hardsubbed streams sufficient?
3. **User Configuration Screen (`/configure`):**
   - Is a web configuration page needed to allow users to toggle specific providers (e.g. disable adult/turn off live sports) before installing the addon?

---

## 11. Next Recommended Step

**Recommended Next Step: TARGET PROMPT #1**
Proceed with **Phase 2 Implementation**:
- Option A: **IMDB / TMDB ID Mapping & Stremio Cinemeta Stream Resolver** (enabling Re-3arabi to appear as a stream source when clicking movies or series in standard Stremio search and Cinemeta catalog).
- Option B: **Porting Batch 2 of CloudStream Providers** (`Alooytv` for Gulf drama, `Asia2tv` for Asian drama, `Aflaam` for classic Arabic cinema, and `Anim3rb` for anime).
