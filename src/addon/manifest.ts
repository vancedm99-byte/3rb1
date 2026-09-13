import { StremioManifest, StremioManifestCatalog } from '../types/stremio.js';
import { registry } from '../providers/index.js';

export function buildManifest(): StremioManifest {
  const providers = registry.getAllProviders();
  const providerTypes = providers.map((p) => p.name);

  const catalogs: StremioManifestCatalog[] = [];

  for (const provider of providers) {
    const pCatalogs = provider.getCatalogs();
    for (const cat of pCatalogs) {
      catalogs.push({
        type: provider.name,
        id: `${provider.id}_${cat.id}`,
        name: cat.name,
        extra: [
          ...(cat.genres && cat.genres.length > 0
            ? [
                {
                  name: 'genre',
                  isRequired: false,
                  options: cat.genres,
                },
              ]
            : []),
          {
            name: 'skip',
            isRequired: false,
          },
          {
            name: 'search',
            isRequired: false,
          },
        ],
      });
    }
  }

  return {
    id: 'community.re3arabi.addon',
    version: '1.1.0',
    name: 'Re-3arabi (عربي وأفلام وبث مباشر)',
    description:
      'Arabic Movies, TV Series, Anime, Turkish Drama, and Live TV from Akwam, FaselHD, Arabseed, WeCima, Anime4up, WitAnime, 3isk, Egydead, SyriaLive, and YacineTV.',
    resources: ['catalog', 'meta', 'stream'],
    types: [...providerTypes, 'movie', 'series', 'anime', 'channel', 'tv'],
    idPrefixes: providers.map((p) => `${p.id}:`),
    catalogs,
    background: 'https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?q=80&w=1920&auto=format&fit=crop',
    logo: 'https://cdn-icons-png.flaticon.com/512/860/860331.png',
    behaviorHints: {
      configurable: false,
      configurationRequired: false,
    },
  };
}

export const manifest: StremioManifest = buildManifest();

