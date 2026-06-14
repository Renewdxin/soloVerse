import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface SafeLinkFetchConfig {
  enabled: boolean;
  allowedHosts: string[];
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
  allowedContentTypes: string[];
}

export interface SafeFetchedLink {
  url: string;
  status: number;
  contentType: string;
  content: string;
}

export interface SafeFetchDenied {
  url: string;
  reason: string;
}

export interface SafeFetchResult {
  fetched: SafeFetchedLink[];
  denied: SafeFetchDenied[];
}

type FetchFn = typeof fetch;
type ResolveFn = (hostname: string) => Promise<string[]>;

export class SafeLinkFetcher {
  constructor(
    private readonly config: SafeLinkFetchConfig,
    private readonly io: {
      fetch: FetchFn;
      resolve: ResolveFn;
    } = {
      fetch,
      resolve: async (hostname) => {
        const records = await lookup(hostname, { all: true, verbatim: true });
        return records.map((r) => r.address);
      },
    },
  ) {}

  async fetchMany(urls: string[]): Promise<SafeFetchResult> {
    const fetched: SafeFetchedLink[] = [];
    const denied: SafeFetchDenied[] = [];
    for (const raw of urls) {
      try {
        if (!this.config.enabled) throw new SafeLinkError("webfetch 未启用");
        fetched.push(await this.fetchOne(raw));
      } catch (error) {
        denied.push({ url: raw, reason: error instanceof Error ? error.message : String(error) });
      }
    }
    return { fetched, denied };
  }

  private async fetchOne(raw: string): Promise<SafeFetchedLink> {
    let current = this.parseAndValidateUrl(raw);
    for (let redirects = 0; redirects <= this.config.maxRedirects; redirects++) {
      await this.validateNetworkTarget(current);
      const response = await this.io.fetch(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
      if (isRedirect(response.status)) {
        const location = response.headers.get("location");
        if (location === null) throw new SafeLinkError("redirect 缺少 Location");
        if (redirects === this.config.maxRedirects) throw new SafeLinkError("redirect 超过上限");
        current = this.parseAndValidateUrl(new URL(location, current).toString());
        continue;
      }

      const contentType = normalizeContentType(response.headers.get("content-type"));
      if (!this.isAllowedContentType(contentType)) {
        throw new SafeLinkError(`content-type 不允许：${contentType || "unknown"}`);
      }
      return {
        url: current.toString(),
        status: response.status,
        contentType,
        content: await readLimitedText(response, this.config.maxBytes),
      };
    }
    throw new SafeLinkError("redirect 超过上限");
  }

  private parseAndValidateUrl(raw: string): URL {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new SafeLinkError("URL 无法解析");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new SafeLinkError(`scheme 不允许：${url.protocol}`);
    }
    if (url.username.length > 0 || url.password.length > 0) {
      throw new SafeLinkError("URL 不允许携带 username/password");
    }
    if (!hostAllowed(url.hostname, this.config.allowedHosts)) {
      throw new SafeLinkError(`host 不在 allowlist：${url.hostname}`);
    }
    return url;
  }

  private async validateNetworkTarget(url: URL): Promise<void> {
    const hostname = stripIpv6Brackets(url.hostname.toLowerCase());
    if (isBlockedHostname(hostname)) throw new SafeLinkError(`host 不允许访问：${hostname}`);
    const directIp = isIP(hostname) ? [hostname] : [];
    const resolved = directIp.length > 0 ? directIp : await this.io.resolve(hostname);
    if (resolved.length === 0) throw new SafeLinkError(`host 无 DNS 记录：${hostname}`);
    for (const address of resolved) {
      if (!isPublicIp(address)) throw new SafeLinkError(`解析到非公网 IP：${address}`);
    }
  }

  private isAllowedContentType(contentType: string): boolean {
    if (contentType.length === 0) return false;
    return this.config.allowedContentTypes.some((allowed) => contentType.startsWith(allowed));
  }
}

class SafeLinkError extends Error {}

function hostAllowed(hostname: string, allowedHosts: string[]): boolean {
  const host = stripIpv6Brackets(hostname.toLowerCase());
  return allowedHosts.some((raw) => {
    const allowed = raw.trim().toLowerCase();
    return allowed.length > 0 && (host === allowed || host.endsWith(`.${allowed}`));
  });
}

function isBlockedHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname === "metadata.google.internal"
  );
}

function isPublicIp(address: string): boolean {
  const host = stripIpv6Brackets(address.toLowerCase());
  if (isIP(host) === 4) return isPublicIpv4(host);
  if (isIP(host) === 6) return isPublicIpv6(host);
  return false;
}

function isPublicIpv4(address: string): boolean {
  const parts = address.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return false;
  }
  const [a = 0, b = 0, c = 0, d = 0] = parts;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a >= 224) return false;
  if (a === 255 && b === 255 && c === 255 && d === 255) return false;
  return true;
}

function isPublicIpv6(address: string): boolean {
  const compact = stripIpv6Brackets(address.toLowerCase());
  // 拒绝本机、未指定、私网、链路本地、组播、文档网段，以及 IPv4-mapped 的内网地址。
  if (
    compact === "::" ||
    compact === "::1" ||
    compact.startsWith("fc") ||
    compact.startsWith("fd") ||
    compact.startsWith("fe8") ||
    compact.startsWith("fe9") ||
    compact.startsWith("fea") ||
    compact.startsWith("feb") ||
    compact.startsWith("ff") ||
    compact.startsWith("2001:db8:")
  ) {
    return false;
  }
  if (compact.startsWith("::ffff:")) {
    const mapped = compact.slice("::ffff:".length);
    return isIP(mapped) === 4 && isPublicIpv4(mapped);
  }
  return true;
}

function stripIpv6Brackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function isRedirect(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status);
}

function normalizeContentType(value: string | null): string {
  return value?.split(";")[0]?.trim().toLowerCase() ?? "";
}

async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new SafeLinkError(`响应超过 ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}
