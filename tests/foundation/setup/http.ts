/**
 * A deliberately tiny HTTP client: manual cookie jar, manual redirect handling.
 *
 * Redirects are never followed automatically, because the redirect itself (its
 * status and Location) is what several acceptance criteria assert.
 */
export interface HttpResponse {
  status: number;
  location: string | null;
  setCookie: string[];
  body: string;
  headers: Headers;
}

export class HttpClient {
  private readonly jar = new Map<string, string>();

  constructor(private readonly baseUrl: string) {}

  cookie(name: string): string | undefined {
    return this.jar.get(name);
  }

  cookieNames(): string[] {
    return [...this.jar.keys()];
  }

  setCookieManually(name: string, value: string): void {
    this.jar.set(name, value);
  }

  clearCookies(): void {
    this.jar.clear();
  }

  private cookieHeader(): string | undefined {
    if (this.jar.size === 0) return undefined;
    return [...this.jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  private absorb(setCookies: string[]): void {
    for (const raw of setCookies) {
      const [pair] = raw.split(';');
      const index = pair.indexOf('=');
      if (index === -1) continue;

      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();

      // Expiry / clearing
      if (value === '' || /(^|;)\s*max-age=0/i.test(raw)) {
        this.jar.delete(name);
        continue;
      }
      this.jar.set(name, value);
    }
  }

  async request(
    path: string,
    init: { method?: string; body?: BodyInit; headers?: Record<string, string> } = {},
  ): Promise<HttpResponse> {
    const headers: Record<string, string> = { ...init.headers };
    const cookies = this.cookieHeader();
    if (cookies) headers.cookie = cookies;

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: init.method ?? 'GET',
      body: init.body,
      headers,
      redirect: 'manual',
    });

    const setCookie = response.headers.getSetCookie();
    this.absorb(setCookie);

    return {
      status: response.status,
      location: response.headers.get('location'),
      setCookie,
      body: await response.text(),
      headers: response.headers,
    };
  }

  get(path: string, headers?: Record<string, string>): Promise<HttpResponse> {
    return this.request(path, { headers });
  }

  /** Fetches the React Server Component payload rather than the HTML. */
  rsc(path: string): Promise<HttpResponse> {
    return this.request(path, { headers: { RSC: '1' } });
  }

  /**
   * Submits a page's form exactly as a browser with JavaScript disabled would:
   * every hidden field the server rendered (including the Server Action
   * reference) is posted back as multipart/form-data.
   *
   * This exercises the real login path - no test-only endpoint exists.
   */
  async submitForm(path: string, values: Record<string, string>): Promise<HttpResponse> {
    const page = await this.get(path);
    if (page.status !== 200) {
      throw new Error(`Expected 200 when loading ${path} to submit it, got ${page.status}.`);
    }

    const body = new FormData();
    for (const [name, value] of Object.entries(parseHiddenFields(page.body))) {
      body.set(name, value);
    }
    for (const [name, value] of Object.entries(values)) {
      body.set(name, value);
    }

    return this.request(path, { method: 'POST', body });
  }
}

export function parseHiddenFields(html: string): Record<string, string> {
  const fields: Record<string, string> = {};

  for (const match of html.matchAll(/<input([^>]*type="hidden"[^>]*)\/?>/g)) {
    const attributes = match[1];
    const name = /name="([^"]*)"/.exec(attributes)?.[1];
    if (!name) continue;

    const raw = /value="([^"]*)"/.exec(attributes)?.[1] ?? '';
    fields[name] = raw
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  }

  return fields;
}

/** Parses one attribute out of a Set-Cookie header line. */
export function cookieAttributes(setCookie: string): {
  name: string;
  value: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string | null;
  path: string | null;
} {
  const [pair, ...rest] = setCookie.split(';').map((part) => part.trim());
  const index = pair.indexOf('=');

  const flags = rest.map((part) => part.toLowerCase());
  const find = (key: string) =>
    rest.find((part) => part.toLowerCase().startsWith(`${key}=`))?.split('=')[1] ?? null;

  return {
    name: pair.slice(0, index),
    value: pair.slice(index + 1),
    httpOnly: flags.includes('httponly'),
    secure: flags.includes('secure'),
    sameSite: find('samesite'),
    path: find('path'),
  };
}
