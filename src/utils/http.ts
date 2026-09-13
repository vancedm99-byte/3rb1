import * as cheerio from 'cheerio';
import { Logger } from './logger.js';

const logger = new Logger('HttpClient');

export interface HttpRequestOptions {
  headers?: Record<string, string>;
  referer?: string;
  cookies?: string;
  timeout?: number;
  body?: any;
  method?: 'GET' | 'POST' | 'HEAD';
  form?: Record<string, string>;
  redirect?: 'follow' | 'manual' | 'error';
}

export interface HttpResponse<T = any> {
  status: number;
  statusText: string;
  url: string;
  headers: Record<string, string>;
  text: string;
  json: () => T;
  $: cheerio.CheerioAPI;
}

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export const MOBILE_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

export const BROWSER_HEADERS: Record<string, string> = {
  'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
};

export class HttpClient {
  private defaultHeaders: Record<string, string>;
  // Domain-isolated cookie jar: Map<domain, Map<cookieName, cookieValue>>
  private domainCookies: Map<string, Map<string, string>> = new Map();
  // Optional global cookies (for callers using setCookie without hostname)
  private globalCookies: Map<string, string> = new Map();

  constructor(defaultHeaders: Record<string, string> = {}) {
    this.defaultHeaders = {
      'User-Agent': DEFAULT_USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
      ...defaultHeaders,
    };
  }

  setCookie(keyOrRawHeader: string, valueOrHost?: string, hostnameOrUrl?: string) {
    let key = keyOrRawHeader;
    let val = valueOrHost || '';
    let host = hostnameOrUrl;

    // Handle 2-argument signature forms:
    if (hostnameOrUrl === undefined) {
      if (keyOrRawHeader.includes('=') && valueOrHost && (valueOrHost.includes('://') || valueOrHost.includes('.'))) {
        // Form: setCookie('foo=bar; Path=/', 'https://example.com')
        const parts = keyOrRawHeader.split(';');
        const first = parts[0]?.trim();
        const eqIdx = first.indexOf('=');
        if (eqIdx > 0) {
          key = first.substring(0, eqIdx).trim();
          val = first.substring(eqIdx + 1).trim();
        }
        host = valueOrHost;
      } else if (valueOrHost && valueOrHost.includes('=') && (keyOrRawHeader.includes('://') || keyOrRawHeader.includes('.'))) {
        // Form: setCookie('https://example.com', 'foo=bar; Path=/')
        host = keyOrRawHeader;
        const parts = valueOrHost.split(';');
        const first = parts[0]?.trim();
        const eqIdx = first.indexOf('=');
        if (eqIdx > 0) {
          key = first.substring(0, eqIdx).trim();
          val = first.substring(eqIdx + 1).trim();
        }
      }
    }

    if (host) {
      let hostStr = host;
      if (host.includes('://')) {
        try {
          hostStr = new URL(host).hostname;
        } catch {}
      }
      hostStr = hostStr.toLowerCase().replace(/^\./, '');
      let hostMap = this.domainCookies.get(hostStr);
      if (!hostMap) {
        hostMap = new Map();
        this.domainCookies.set(hostStr, hostMap);
      }
      hostMap.set(key, val);
    } else {
      this.globalCookies.set(key, val);
    }
  }

  getCookieString(targetUrlOrHostname?: string): string {
    const parts: string[] = [];
    const seenKeys = new Set<string>();

    if (targetUrlOrHostname) {
      let host = targetUrlOrHostname;
      if (targetUrlOrHostname.includes('://')) {
        try {
          host = new URL(targetUrlOrHostname).hostname;
        } catch {}
      }
      host = host.toLowerCase();

      // Match exact host or parent domains
      for (const [domain, cookies] of this.domainCookies.entries()) {
        if (host === domain || host.endsWith('.' + domain)) {
          cookies.forEach((val, key) => {
            if (!seenKeys.has(key)) {
              seenKeys.add(key);
              parts.push(`${key}=${val}`);
            }
          });
        }
      }
    } else {
      // If no host specified, collect all domain cookies
      for (const cookies of this.domainCookies.values()) {
        cookies.forEach((val, key) => {
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            parts.push(`${key}=${val}`);
          }
        });
      }
    }

    // Append global cookies
    this.globalCookies.forEach((val, key) => {
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        parts.push(`${key}=${val}`);
      }
    });

    return parts.join('; ');
  }

  clearCookies(hostnameOrUrl?: string): void {
    if (hostnameOrUrl) {
      let host = hostnameOrUrl;
      if (hostnameOrUrl.includes('://')) {
        try {
          host = new URL(hostnameOrUrl).hostname;
        } catch {}
      }
      host = host.toLowerCase().replace(/^\./, '');
      this.domainCookies.delete(host);
    } else {
      this.domainCookies.clear();
      this.globalCookies.clear();
    }
  }

  async request<T = any>(url: string, options: HttpRequestOptions = {}): Promise<HttpResponse<T>> {
    const controller = new AbortController();
    const timeout = options.timeout || 15000;
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    let reqHostname = '';
    try {
      reqHostname = new URL(url).hostname.toLowerCase();
    } catch {}

    const headers: Record<string, string> = {
      ...this.defaultHeaders,
      ...(options.headers || {}),
    };

    // Remove empty headers (allows callers to suppress default headers like Accept-Language)
    for (const key of Object.keys(headers)) {
      if (headers[key] === '') {
        delete headers[key];
      }
    }

    if (options.referer) {
      headers['Referer'] = options.referer;
    }

    const cookieHeader = [this.getCookieString(reqHostname), options.cookies].filter(Boolean).join('; ');
    if (cookieHeader) {
      headers['Cookie'] = cookieHeader;
    }

    let body: BodyInit | undefined = undefined;
    const method = options.method || (options.form || options.body ? 'POST' : 'GET');

    if (options.form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(options.form)) {
        searchParams.append(key, value);
      }
      body = searchParams.toString();
    } else if (options.body) {
      if (typeof options.body === 'object' && !(options.body instanceof String)) {
        headers['Content-Type'] = headers['Content-Type'] || 'application/json';
        body = JSON.stringify(options.body);
      } else {
        body = String(options.body);
      }
    }

    try {
      const resp = await fetch(url, {
        method,
        headers,
        body,
        redirect: options.redirect || 'follow',
        signal: controller.signal,
      });

      const responseHeaders: Record<string, string> = {};
      resp.headers.forEach((val, key) => {
        responseHeaders[key.toLowerCase()] = val;
      });

      // Track set-cookie (supporting both multi-cookie getSetCookie and standard fallback)
      const setCookies: string[] = typeof (resp.headers as any).getSetCookie === 'function'
        ? (resp.headers as any).getSetCookie()
        : (resp.headers.get('set-cookie') ? [resp.headers.get('set-cookie')!] : []);

      for (const cookieStr of setCookies) {
        const parts = cookieStr.split(';');
        const first = parts[0]?.trim();
        if (first) {
          const eqIdx = first.indexOf('=');
          if (eqIdx > 0) {
            const k = first.substring(0, eqIdx).trim();
            const v = first.substring(eqIdx + 1).trim();
            if (k && v && !['path', 'expires', 'domain', 'samesite', 'secure', 'httponly', 'max-age'].includes(k.toLowerCase())) {
              let cookieDomain = reqHostname;
              for (let i = 1; i < parts.length; i++) {
                const attr = parts[i].trim();
                if (attr.toLowerCase().startsWith('domain=')) {
                  const rawDomain = attr.substring(7).trim().toLowerCase().replace(/^\./, '');
                  if (rawDomain) {
                    cookieDomain = rawDomain;
                  }
                }
              }
              this.setCookie(k, v, cookieDomain);
            }
          }
        }
      }

      const text = await resp.text();

      return {
        status: resp.status,
        statusText: resp.statusText,
        url: resp.url,
        headers: responseHeaders,
        text,
        json: () => {
          try {
            return JSON.parse(text);
          } catch (e) {
            throw new Error(`Failed to parse JSON response: ${(e as Error).message}`);
          }
        },
        $: cheerio.load(text),
      };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error(`Request timed out after ${timeout}ms: ${url}`);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async get<T = any>(url: string, options: Omit<HttpRequestOptions, 'method'> = {}): Promise<HttpResponse<T>> {
    return this.request<T>(url, { ...options, method: 'GET' });
  }

  async post<T = any>(url: string, options: Omit<HttpRequestOptions, 'method'> = {}): Promise<HttpResponse<T>> {
    return this.request<T>(url, { ...options, method: 'POST' });
  }
}

export const http = new HttpClient();
