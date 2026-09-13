interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  staleUntil?: number;
  isRevalidating?: boolean;
}

export class MemoryCache {
  private store: Map<string, CacheEntry<any>> = new Map();
  private maxEntries: number;

  constructor(maxEntries: number = 2000) {
    this.maxEntries = maxEntries;
  }

  set<T>(key: string, value: T, ttlSeconds: number = 300, staleTtlSeconds: number = 0): void {
    if (this.store.size >= this.maxEntries) {
      this.purgeExpired();
      if (this.store.size >= this.maxEntries) {
        const firstKey = this.store.keys().next().value;
        if (firstKey) this.store.delete(firstKey);
      }
    }

    const now = Date.now();
    const freshUntil = now + ttlSeconds * 1000;
    const staleUntil = staleTtlSeconds > 0 ? freshUntil + staleTtlSeconds * 1000 : freshUntil;

    this.store.set(key, {
      value,
      expiresAt: freshUntil,
      staleUntil,
    });
  }

  get<T>(key: string, allowStale: boolean = false): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;

    const now = Date.now();
    const maxExpiry = entry.staleUntil ?? entry.expiresAt;

    if (now > maxExpiry) {
      this.store.delete(key);
      return null;
    }

    if (!allowStale && now > entry.expiresAt) {
      return null;
    }

    return entry.value as T;
  }

  getStaleInfo<T>(key: string): { value: T; isStale: boolean } | null {
    const entry = this.store.get(key);
    if (!entry) return null;

    const now = Date.now();
    const maxExpiry = entry.staleUntil ?? entry.expiresAt;

    if (now > maxExpiry) {
      this.store.delete(key);
      return null;
    }

    return {
      value: entry.value as T,
      isStale: now > entry.expiresAt,
    };
  }

  isStale(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    const now = Date.now();
    return now > entry.expiresAt && now <= (entry.staleUntil ?? entry.expiresAt);
  }

  async getOrRevalidate<T>(
    key: string,
    fetcher: () => Promise<T>,
    options: { ttlSeconds?: number; staleTtlSeconds?: number; onError?: (err: any) => void } = {}
  ): Promise<T> {
    const ttl = options.ttlSeconds ?? 300;
    const staleTtl = options.staleTtlSeconds ?? 0;
    const entry = this.store.get(key);
    const now = Date.now();

    if (entry) {
      const maxExpiry = entry.staleUntil ?? entry.expiresAt;
      if (now <= maxExpiry) {
        const isStale = now > entry.expiresAt;
        if (isStale && !entry.isRevalidating) {
          entry.isRevalidating = true;
          // Background revalidation without blocking caller
          fetcher()
            .then((freshValue) => {
              if (freshValue !== null && freshValue !== undefined) {
                this.set(key, freshValue, ttl, staleTtl);
              }
            })
            .catch((err) => {
              if (options.onError) {
                options.onError(err);
              }
            })
            .finally(() => {
              const current = this.store.get(key);
              if (current) current.isRevalidating = false;
            });
        }
        return entry.value as T;
      } else {
        this.store.delete(key);
      }
    }

    // No valid or stale entry: blocking fetch
    const fresh = await fetcher();
    if (fresh !== null && fresh !== undefined) {
      this.set(key, fresh, ttl, staleTtl);
    }
    return fresh;
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  private purgeExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      const maxExpiry = entry.staleUntil ?? entry.expiresAt;
      if (now > maxExpiry) {
        this.store.delete(key);
      }
    }
  }
}

export const globalCache = new MemoryCache();
