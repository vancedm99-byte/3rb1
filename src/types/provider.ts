import { StremioCatalogItem, StremioContentType, StremioMetaDetail, StremioStream } from './stremio.js';

export interface ProviderItem {
  id: string; // e.g. akwam:1234 or faselhd:watch/5678
  provider: string;
  type: StremioContentType;
  title: string;
  poster?: string;
  year?: number;
  description?: string;
  url: string;
}

export interface ProviderEpisode {
  id: string; // e.g. akwam:series/12:s1e1
  title: string;
  season: number;
  episode: number;
  url: string;
  poster?: string;
}

export interface ProviderDetail extends ProviderItem {
  background?: string;
  genres?: string[];
  cast?: string[];
  episodes?: ProviderEpisode[];
}

export interface ResolvedStream {
  name: string; // Server / Provider name (e.g. "FaselHD - Server 1")
  title?: string; // Display title / subtitle in Stremio stream list
  quality?: string; // e.g. "1080p", "720p", "Auto"
  url: string;
  headers?: Record<string, string>;
  isM3u8?: boolean;
  behaviorHints?: {
    notWebReady?: boolean;
    bingeGroup?: string;
    proxyHeaders?: {
      request?: Record<string, string>;
      response?: Record<string, string>;
    };
  };
}

export interface ProviderCatalogDefinition {
  id: string; // e.g. 'movies', 'series', 'anime', 'live-channels', 'live-matches'
  name: string; // Display name e.g. 'الأفلام (Movies)'
  genres?: string[]; // Supported genres / categories for this catalog
}

export interface IProvider {
  id: string;
  name: string;
  lang: string;
  mainUrl: string;
  supportedTypes: StremioContentType[];

  getCatalogs(): ProviderCatalogDefinition[];
  search(query: string): Promise<ProviderItem[]>;
  getCatalog(catalogId: string, page?: number, genre?: string): Promise<ProviderItem[]>;
  getMeta(contentId: string, type: StremioContentType | string): Promise<ProviderDetail | null>;
  getStreams(contentId: string, type: StremioContentType | string, episodeId?: string): Promise<ResolvedStream[]>;
}
