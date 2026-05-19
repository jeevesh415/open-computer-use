/**
 * Error-mapping tests.
 *
 * The `describeError` helper in src/errors.ts attaches a "Hint:" line to
 * every Coasty error code so the LLM gets enough context to either
 * self-correct (for 422 typos) or surface a useful message to the user.
 *
 * Every documented error path is tested here so we know the agent receives
 * actionable text — not just a status code.
 */

import { describe, expect, it } from "vitest";

import { describeError, errorResult } from "../src/errors.js";
import type { CoastyError } from "../src/errors.js";

function makeErr(status: number, code = "TEST", message = "test"): CoastyError {
  return { status, code, message, requestId: "req_test" };
}

describe("describeError — hint per status", () => {
  it("401 mentions API key may be missing/revoked", () => {
    expect(describeError(makeErr(401, "INVALID_API_KEY"))).toMatch(/COASTY_API_KEY/);
  });

  it("402 mentions credits + sandbox key", () => {
    const text = describeError(makeErr(402, "INSUFFICIENT_CREDITS"));
    expect(text).toMatch(/credits/i);
    expect(text).toMatch(/sk-coasty-test-/);
  });

  it("403 mentions scope + dashboard URL", () => {
    const text = describeError(makeErr(403, "INSUFFICIENT_SCOPE"));
    expect(text).toMatch(/scope/i);
    expect(text).toMatch(/coasty\.ai\/developers/);
  });

  it("404 explains 404-not-403-on-cross-tenant policy", () => {
    const text = describeError(makeErr(404, "NOT_FOUND"));
    expect(text).toMatch(/404 \(not 403\)/);
  });

  it("409 explains state conflict", () => {
    expect(describeError(makeErr(409, "INVALID_STATE"))).toMatch(/state/i);
  });

  it("422 advises checking required + extra-field rules", () => {
    const text = describeError(makeErr(422, "VALIDATION_ERROR"));
    expect(text).toMatch(/unknown fields|extra fields|validation/i);
  });

  it("429 mentions Retry-After", () => {
    expect(describeError(makeErr(429, "RATE_LIMIT_EXCEEDED"))).toMatch(/Retry-After/i);
  });

  it("500 mentions backoff + support contact", () => {
    const text = describeError(makeErr(500, "SERVER_ERROR"));
    expect(text).toMatch(/backoff|support/i);
  });

  it("includes status code AND error code in headline", () => {
    const text = describeError(makeErr(403, "INSUFFICIENT_SCOPE", "Need scope X"));
    expect(text).toContain("403");
    expect(text).toContain("INSUFFICIENT_SCOPE");
    expect(text).toContain("Need scope X");
  });

  it("includes request_id when present", () => {
    expect(describeError({ status: 500, code: "X", message: "m", requestId: "req_abc123" })).toContain(
      "req_abc123",
    );
  });

  it("omits request_id line when not present", () => {
    expect(describeError({ status: 500, code: "X", message: "m" })).not.toMatch(/request_id=/);
  });

  it("unknown-status defaults to no specific hint (just headline + req)", () => {
    const text = describeError(makeErr(418, "TEAPOT"));
    expect(text).toContain("418");
    expect(text).toContain("TEAPOT");
    expect(text).not.toMatch(/Hint:/);
  });
});

describe("errorResult — MCP shape", () => {
  it("wraps a CoastyError in {content:[text], isError:true}", () => {
    const r = errorResult(makeErr(402, "INSUFFICIENT_CREDITS", "broke"));
    expect(r.isError).toBe(true);
    expect(r.content[0].type).toBe("text");
    expect(r.content[0].text).toContain("INSUFFICIENT_CREDITS");
  });

  it("wraps a plain string", () => {
    const r = errorResult("network down");
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe("network down");
  });

  it("isError is the literal `true`, not just truthy", () => {
    const r = errorResult("x");
    expect(r.isError).toStrictEqual(true);
  });
});
