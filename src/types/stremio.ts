export type StremioContentType = 'movie' | 'series' | 'channel' | 'tv' | 'anime' | string;

export interface StremioManifest {
  id: string;
  version: string;
  name: string;
  description: string;
  resources: Array<
    | 'catalog'
    | 'meta'
    | 'stream'
    | 'subtitles'
    | {
        name: 'catalog' | 'meta' | 'stream' | 'subtitles' | string;
        types: string[];
        idPrefixes?: string[];
      }
  >;
  types: string[];
  catalogs: StremioCatalogDef[];
  idPrefixes?: string[];
  background?: string;
  logo?: string;
  contactEmail?: string;
  behaviorHints?: {
    adult?: boolean;
    p2p?: boolean;
    configurable?: boolean;
    configurationRequired?: boolean;
  };
}

export interface StremioCatalogDef {
  type: string;
  id: string;
  name: string;
  extra?: Array<{
    name: 'search' | 'genre' | 'skip' | string;
    isRequired?: boolean;
    options?: string[];
  }>;
}

export type StremioManifestCatalog = StremioCatalogDef;

export interface StremioCatalogItem {
  id: string;
  type: string;
  name: string;
  poster?: string;
  description?: string;
  genres?: string[];
  releaseInfo?: string;
  imdbRating?: string;
}

export interface StremioMetaVideo {
  id: string;
  title: string;
  released?: string;
  thumbnail?: string;
  episode: number;
  season: number;
  overview?: string;
}

export interface StremioMetaDetail {
  id: string;
  type: StremioContentType;
  name: string;
  poster?: string;
  background?: string;
  logo?: string;
  description?: string;
  releaseInfo?: string;
  year?: number;
  genres?: string[];
  imdbRating?: string;
  director?: string[];
  cast?: string[];
  videos?: StremioMetaVideo[];
  behaviorHints?: {
    defaultVideoId?: string;
    hasScheduledVideos?: boolean;
  };
}

export interface StremioStream {
  name: string;
  title?: string;
  url?: string;
  externalUrl?: string;
  ytId?: string;
  infoHash?: string;
  fileIdx?: number;
  behaviorHints?: {
    notWebReady?: boolean;
    bingeGroup?: string;
    proxyHeaders?: {
      request?: Record<string, string>;
      response?: Record<string, string>;
    };
  };
}

export interface StremioSubtitle {
  id: string;
  url: string;
  lang: string;
}
