/**
 * CoastyClient tests — verify the HTTP wrapper:
 *
 * - Sends X-API-Key + User-Agent + X-Coasty-Source headers
 * - Forwards Idempotency-Key when supplied
 * - Maps query params correctly
 * - Translates error envelopes to CoastyError shape
 * - Throws TransportError on network failures + timeouts
 * - Strips trailing slashes from base URL
 * - Drops null/undefined query values
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CoastyClient, isCoastyError } from "../src/client.js";
import type { Config } from "../src/config.js";
import { TransportError } from "../src/errors.js";

const CFG: Config = {
  apiKey: "sk-coasty-test-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  baseUrl: "https://coasty.ai",
  timeoutMs: 10_000,
  userAgent: "coasty-mcp-test/0.0.0",
  debug: false,
};

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  fetchSpy.mockRestore();
});

function ok<T>(body: T, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("CoastyClient", () => {
  it("sends auth + user-agent + source headers on every request", async () => {
    fetchSpy.mockResolvedValueOnce(ok({ ok: true }));
    const client = new CoastyClient(CFG);
    await client.get("/v1/machines");
    const [, init] = fetchSpy.mock.calls[0]!;
    const headers = init?.headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBe(CFG.apiKey);
    expect(headers["User-Agent"]).toContain("coasty-mcp-test");
    expect(headers["X-Coasty-Source"]).toBe("mcp");
    expect(headers["Accept"]).toBe("application/json");
  });

  it("forwards Idempotency-Key when supplied", async () => {
    fetchSpy.mockResolvedValueOnce(ok({}));
    const client = new CoastyClient(CFG);
    await client.post("/v1/machines", { name: "x" }, { idempotencyKey: "abc-123" });
    const [, init] = fetchSpy.mock.calls[0]!;
    const headers = init?.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("abc-123");
  });

  it("does NOT set Idempotency-Key when omitted", async () => {
    fetchSpy.mockResolvedValueOnce(ok({}));
    const client = new CoastyClient(CFG);
    await client.post("/v1/machines", { name: "x" });
    const [, init] = fetchSpy.mock.calls[0]!;
    const headers = init?.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBeUndefined();
  });

  it("appends query params, dropping null/undefined", async () => {
    fetchSpy.mockResolvedValueOnce(ok({}));
    const client = new CoastyClient(CFG);
    await client.get("/v1/machines", {
      query: { limit: 50, cursor: undefined, status: null, q: "foo bar" },
    });
    const url = String(fetchSpy.mock.calls[0]![0]);
    expect(url).toContain("limit=50");
    expect(url).not.toContain("cursor=");
    expect(url).not.toContain("status=");
    expect(url).toContain("q=foo+bar");
  });

  it("strips trailing slash from baseUrl", async () => {
    const cfg: Config = { ...CFG, baseUrl: "https://coasty.ai///" };
    fetchSpy.mockResolvedValueOnce(ok({}));
    const client = new CoastyClient(cfg);
    await client.get("/v1/machines");
    expect(String(fetchSpy.mock.calls[0]![0])).toBe("https://coasty.ai/v1/machines");
  });

  it("treats path without leading slash correctly", async () => {
    fetchSpy.mockResolvedValueOnce(ok({}));
    const client = new CoastyClient(CFG);
    await client.get("v1/machines");
    expect(String(fetchSpy.mock.calls[0]![0])).toBe("https://coasty.ai/v1/machines");
  });

  it("returns parsed JSON on 2xx", async () => {
    fetchSpy.mockResolvedValueOnce(ok({ data: [1, 2, 3] }));
    const client = new CoastyClient(CFG);
    const out = await client.get<{ data: number[] }>("/v1/machines");
    expect(out.data).toEqual([1, 2, 3]);
  });

  it("translates Coasty error envelopes to CoastyError", async () => {
    fetchSpy.mockResolvedValueOnce(
      ok(
        {
          error: {
            code: "INSUFFICIENT_CREDITS",
            message: "Need 20 credits",
            type: "billing_error",
            request_id: "req_abc",
          },
        },
        402,
      ),
    );
    const client = new CoastyClient(CFG);
    try {
      await client.post("/v1/machines", { name: "x" });
      throw new Error("should have thrown");
    } catch (e) {
      expect(isCoastyError(e)).toBe(true);
      if (!isCoastyError(e)) throw e;
      expect(e.status).toBe(402);
      expect(e.code).toBe("INSUFFICIENT_CREDITS");
      expect(e.message).toBe("Need 20 credits");
      expect(e.requestId).toBe("req_abc");
    }
  });

  it("falls back to HTTP_<status> code when envelope is missing", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("Bad Gateway", { status: 502 }));
    const client = new CoastyClient(CFG);
    try {
      await client.get("/v1/machines");
    } catch (e) {
      expect(isCoastyError(e)).toBe(true);
      if (!isCoastyError(e)) throw e;
      expect(e.status).toBe(502);
      expect(e.code).toBe("HTTP_502");
    }
  });

  it("falls back to X-Coasty-Request-Id header when envelope lacks request_id", async () => {
    fetchSpy.mockResolvedValueOnce(
      ok({ error: { code: "NOT_FOUND", message: "x" } }, 404, {
        "X-Coasty-Request-Id": "req_via_header",
      }),
    );
    const client = new CoastyClient(CFG);
    try {
      await client.get("/v1/machines/x");
    } catch (e) {
      if (!isCoastyError(e)) throw e;
      expect(e.requestId).toBe("req_via_header");
    }
  });

  it("throws TransportError with abort message on timeout", async () => {
    const cfg: Config = { ...CFG, timeoutMs: 50 };
    // Fake a fetch that never resolves until the abort signal fires.
    fetchSpy.mockImplementationOnce((_url, init) => {
      const sig = (init as RequestInit).signal as AbortSignal;
      return new Promise((_resolve, reject) => {
        sig.addEventListener("abort", () => {
          const err = new Error("aborted") as Error & { name: string };
          err.name = "AbortError";
          reject(err);
        });
      });
    });
    const client = new CoastyClient(cfg);
    await expect(client.get("/v1/machines")).rejects.toMatchObject({
      name: "TransportError",
    });
  });

  it("throws TransportError on network failure", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const client = new CoastyClient(CFG);
    await expect(client.get("/v1/machines")).rejects.toBeInstanceOf(TransportError);
  });

  it("sets Content-Type only when there's a body", async () => {
    fetchSpy.mockResolvedValueOnce(ok({}));
    const client = new CoastyClient(CFG);
    await client.get("/v1/machines");
    let headers = (fetchSpy.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers["Content-Type"]).toBeUndefined();

    fetchSpy.mockResolvedValueOnce(ok({}));
    await client.post("/v1/machines", { x: 1 });
    headers = (fetchSpy.mock.calls[1]![1] as RequestInit).headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
  });
});
