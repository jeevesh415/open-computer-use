import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConfigError, loadConfig } from "../src/config.js";

const ORIG = { ...process.env };

beforeEach(() => {
  delete process.env.COASTY_API_KEY;
  delete process.env.COASTY_API_BASE_URL;
  delete process.env.COASTY_TIMEOUT_MS;
  delete process.env.COASTY_MCP_DEBUG;
});

afterEach(() => {
  for (const k of [
    "COASTY_API_KEY",
    "COASTY_API_BASE_URL",
    "COASTY_TIMEOUT_MS",
    "COASTY_MCP_DEBUG",
  ]) {
    if (ORIG[k] !== undefined) process.env[k] = ORIG[k];
    else delete process.env[k];
  }
});

describe("loadConfig", () => {
  it("throws ConfigError when no API key is provided", () => {
    expect(() => loadConfig()).toThrow(ConfigError);
  });

  it("throws ConfigError on a key that's not Coasty-shaped", () => {
    expect(() => loadConfig({ apiKey: "sk-anthropic-..." })).toThrow(ConfigError);
    expect(() => loadConfig({ apiKey: "" })).toThrow(ConfigError);
  });

  it("accepts sk-coasty-live-* and sk-coasty-test-* keys", () => {
    expect(loadConfig({ apiKey: "sk-coasty-live-abcdefghijklmnopqrstuvwx" }).apiKey).toContain(
      "sk-coasty-live-",
    );
    expect(loadConfig({ apiKey: "sk-coasty-test-abcdefghijklmnopqrstuvwx" }).apiKey).toContain(
      "sk-coasty-test-",
    );
  });

  it("accepts legacy cua_sk_ keys for back-compat", () => {
    expect(loadConfig({ apiKey: "cua_sk_abcdef" }).apiKey).toBe("cua_sk_abcdef");
  });

  it("trims surrounding whitespace from the API key", () => {
    const cfg = loadConfig({ apiKey: "  sk-coasty-test-aaaa  " });
    expect(cfg.apiKey).toBe("sk-coasty-test-aaaa");
  });

  it("strips trailing slashes from baseUrl", () => {
    const cfg = loadConfig({
      apiKey: "sk-coasty-test-aaaa",
      baseUrl: "https://coasty.ai///",
    });
    expect(cfg.baseUrl).toBe("https://coasty.ai");
  });

  it("clamps timeoutMs to [1000, 300000]", () => {
    const tooLow = loadConfig({ apiKey: "sk-coasty-test-x", timeoutMs: 10 });
    expect(tooLow.timeoutMs).toBe(1000);
    const tooHigh = loadConfig({ apiKey: "sk-coasty-test-x", timeoutMs: 99_999_999 });
    expect(tooHigh.timeoutMs).toBe(300_000);
  });

  it("uses sane defaults when timeoutMs is invalid", () => {
    const negative = loadConfig({ apiKey: "sk-coasty-test-x", timeoutMs: -5 });
    expect(negative.timeoutMs).toBe(90_000);
    const nan = loadConfig({ apiKey: "sk-coasty-test-x", timeoutMs: NaN });
    expect(nan.timeoutMs).toBe(90_000);
  });

  it("respects COASTY_API_KEY env var when no arg supplied", () => {
    process.env.COASTY_API_KEY = "sk-coasty-test-from-env";
    expect(loadConfig().apiKey).toBe("sk-coasty-test-from-env");
  });

  it("CLI arg overrides env var", () => {
    process.env.COASTY_API_KEY = "sk-coasty-test-from-env";
    expect(loadConfig({ apiKey: "sk-coasty-test-from-arg" }).apiKey).toBe(
      "sk-coasty-test-from-arg",
    );
  });

  it("respects COASTY_MCP_DEBUG env var", () => {
    process.env.COASTY_API_KEY = "sk-coasty-test-x";
    process.env.COASTY_MCP_DEBUG = "1";
    expect(loadConfig().debug).toBe(true);
    process.env.COASTY_MCP_DEBUG = "true";
    expect(loadConfig().debug).toBe(true);
    process.env.COASTY_MCP_DEBUG = "no";
    expect(loadConfig().debug).toBe(false);
  });
});
