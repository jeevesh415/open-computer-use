/**
 * HTTP client wrapping the Coasty REST API.
 *
 * Design choices:
 *
 * * **Plain fetch, zero deps.** Node 18+ has global fetch. Avoiding axios /
 *   undici / etc. keeps the npm package small and reduces supply-chain surface
 *   — important for an MCP server that ships into people's auth-credentialed
 *   environments.
 *
 * * **AbortController timeout.** The Coasty backend caps long-running calls
 *   at ~90 s (matches Cloudflare's edge timeout). We mirror that here so a
 *   stuck call doesn't tie up the MCP client.
 *
 * * **Idempotency-Key passthrough.** Tools that POST to idempotent endpoints
 *   (provision, snapshot, action, schedule create, schedule run, terminal,
 *   files-write, browser ops, trigger create) optionally accept an
 *   ``idempotencyKey`` parameter — if the user retries due to a network blip
 *   they get the cached result, not a duplicate side effect.
 *
 * * **Structured errors.** Every non-2xx response is parsed into the
 *   ``CoastyError`` shape (errors.ts) and propagated to the tool, which
 *   turns it into ``{ isError: true, content: [{ type: "text", text: ... }] }``
 *   for the LLM to recover from.
 *
 * * **No retry by default.** MCP clients have their own retry layer; we'd
 *   rather surface a fast 5xx with a useful Retry-After than silently re-hit
 *   the API.
 */

import type { Config } from "./config.js";
import { TransportError, type CoastyError } from "./errors.js";

export type RequestOptions = {
  /** Extra headers (Idempotency-Key, etc.). Authorization + X-API-Key handled internally. */
  headers?: Record<string, string>;
  /** Override the per-request timeout. Defaults to config.timeoutMs. */
  timeoutMs?: number;
  /** Idempotency-Key shorthand — sets the header iff defined. */
  idempotencyKey?: string;
  /** Query params (URLSearchParams-friendly). */
  query?: Record<string, string | number | boolean | undefined | null>;
};

export class CoastyClient {
  constructor(private readonly cfg: Config) {}

  async get<T = unknown>(path: string, opts?: RequestOptions): Promise<T> {
    return this.request<T>("GET", path, undefined, opts);
  }

  async post<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    return this.request<T>("POST", path, body, opts);
  }

  async patch<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    return this.request<T>("PATCH", path, body, opts);
  }

  async delete<T = unknown>(path: string, opts?: RequestOptions): Promise<T> {
    return this.request<T>("DELETE", path, undefined, opts);
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    body: unknown,
    opts: RequestOptions = {},
  ): Promise<T> {
    if (!path.startsWith("/")) path = `/${path}`;
    const url = new URL(path, this.cfg.baseUrl);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v === undefined || v === null) continue;
        url.searchParams.set(k, String(v));
      }
    }

    const headers: Record<string, string> = {
      "X-API-Key": this.cfg.apiKey,
      "User-Agent": this.cfg.userAgent,
      "X-Coasty-Source": "mcp",
      Accept: "application/json",
      ...(opts.headers ?? {}),
    };
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const controller = new AbortController();
    const timeoutMs = opts.timeoutMs ?? this.cfg.timeoutMs;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    if (this.cfg.debug) {
      const safeHeaders = { ...headers, "X-API-Key": "[redacted]" };
      // eslint-disable-next-line no-console
      console.error(
        `[coasty-mcp] → ${method} ${url.pathname}${url.search}  headers=${JSON.stringify(safeHeaders)}`,
      );
    }

    let resp: Response;
    try {
      resp = await fetch(url.toString(), {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timer);
      const isAbort = err instanceof Error && err.name === "AbortError";
      throw new TransportError(
        isAbort
          ? `Coasty API request timed out after ${timeoutMs}ms (${method} ${path})`
          : `Coasty API request failed (${method} ${path}): ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
    clearTimeout(timer);

    const text = await resp.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        // Non-JSON body. Pass through as raw text in the error envelope below.
        parsed = { raw: text };
      }
    }

    if (this.cfg.debug) {
      // eslint-disable-next-line no-console
      console.error(
        `[coasty-mcp] ← ${resp.status} ${method} ${url.pathname}` +
          (resp.headers.get("X-Coasty-Request-Id")
            ? `  req=${resp.headers.get("X-Coasty-Request-Id")}`
            : ""),
      );
    }

    if (!resp.ok) {
      const env = (parsed as Record<string, unknown> | undefined)?.["error"] as
        | Record<string, unknown>
        | undefined;
      const err: CoastyError = {
        status: resp.status,
        code: String(env?.["code"] ?? `HTTP_${resp.status}`),
        message: String(
          env?.["message"] ??
            (typeof parsed === "object" && parsed && "raw" in parsed
              ? String((parsed as { raw: string }).raw).slice(0, 500)
              : resp.statusText),
        ),
        type: env?.["type"] as string | undefined,
        requestId: (env?.["request_id"] as string | undefined) ?? resp.headers.get("X-Coasty-Request-Id") ?? undefined,
        raw: parsed,
      };
      throw err;
    }

    return parsed as T;
  }
}

export function isCoastyError(e: unknown): e is CoastyError {
  return (
    typeof e === "object" &&
    e !== null &&
    "status" in e &&
    "code" in e &&
    "message" in e &&
    typeof (e as { status: unknown }).status === "number"
  );
}
