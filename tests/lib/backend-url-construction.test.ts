/**
 * Anti-regression for the deployed-vs-local URL-construction bug class.
 *
 * # Background
 *
 * `app/api/files/route.ts` historically built the upstream URL via string
 * template concatenation:
 *
 *     fetch(`${PYTHON_BACKEND_URL}${endpoint}`, …)
 *
 * If `PYTHON_BACKEND_URL` carried an accidental trailing slash —
 * `http://internal-alb:8001/` — and `endpoint` started with `/api/files/list`
 * the result was `http://internal-alb:8001//api/files/list`, a malformed
 * URL.  Some load balancers normalise the double slash silently, others
 * 400 / 404; either way the failure mode looked identical to the user
 * ("files don't show in deployment, work locally") because the local dev
 * `http://127.0.0.1:8001` default has no trailing slash.
 *
 * The fix is `new URL(path, base)`, which:
 *   - normalises the join (a trailing slash on base is harmless),
 *   - throws synchronously when `base` is genuinely malformed (so the
 *     misconfiguration is loud, not silent),
 *   - preserves the encoded path correctly.
 *
 * These tests pin the construction's behaviour for every shape of
 * `PYTHON_BACKEND_URL` we've seen in real deployments.
 */

import { describe, it, expect } from "vitest"

/** Mirror the construction the Files proxy now uses, in pure form. */
function buildUpstreamUrl(base: string, op: string | null): string {
  const path = op ? `/api/files/${op}` : "/api/files"
  return new URL(path, base).toString()
}

describe("file proxy URL construction", () => {
  it("base without trailing slash: joins cleanly", () => {
    expect(buildUpstreamUrl("http://internal-alb:8001", "list")).toBe(
      "http://internal-alb:8001/api/files/list",
    )
  })

  it("base with trailing slash: still joins cleanly (NEW protection)", () => {
    // Pre-fix this produced `//api/files/list` and broke depending on the
    // load balancer's normalisation policy.
    expect(buildUpstreamUrl("http://internal-alb:8001/", "list")).toBe(
      "http://internal-alb:8001/api/files/list",
    )
  })

  it("base with subpath: replaces the base path correctly", () => {
    // If someone ever sets PYTHON_BACKEND_URL to e.g. `http://gw/api/v2`
    // we want a SINGLE absolute path replacement (not concatenation).
    // `new URL` does this correctly: the base path is replaced because
    // our path starts with `/`.
    expect(buildUpstreamUrl("http://internal-alb:8001/v2", "list")).toBe(
      "http://internal-alb:8001/api/files/list",
    )
  })

  it("op=null falls back to the directory listing endpoint", () => {
    expect(buildUpstreamUrl("http://internal-alb:8001", null)).toBe(
      "http://internal-alb:8001/api/files",
    )
  })

  it("https base preserved", () => {
    expect(buildUpstreamUrl("https://api.example.com:8001", "upload")).toBe(
      "https://api.example.com:8001/api/files/upload",
    )
  })

  it("port-only host (dev fallback) joins cleanly", () => {
    expect(buildUpstreamUrl("http://127.0.0.1:8001", "list")).toBe(
      "http://127.0.0.1:8001/api/files/list",
    )
  })

  it("internal AWS ALB DNS — the actual deployed value", () => {
    // From `infra/aws/terraform.tfstate -> internal_alb_dns`.
    expect(
      buildUpstreamUrl(
        "http://internal-llmhub-int-alb-1814174524.us-east-1.elb.amazonaws.com:8001",
        "list",
      ),
    ).toBe(
      "http://internal-llmhub-int-alb-1814174524.us-east-1.elb.amazonaws.com:8001/api/files/list",
    )
  })

  it("malformed base throws synchronously (loud failure, not silent)", () => {
    // The OLD string-template code would happily produce
    // `not-a-url/api/files/list` and only fail at fetch() — which was hard
    // to diagnose in CloudWatch.  The new construction throws here so the
    // error shows up at the URL-building step with a clear message.
    expect(() => buildUpstreamUrl("not-a-url", "list")).toThrow()
    expect(() => buildUpstreamUrl("", "list")).toThrow()
    expect(() => buildUpstreamUrl("://malformed", "list")).toThrow()
  })

  it("all 7 file operations build the right URLs", () => {
    const ops = [
      "list",
      "upload",
      "upload-multipart",
      "download",
      "download-stream",
      "delete",
      "create-folder",
    ]
    const base = "http://internal-alb:8001"
    for (const op of ops) {
      expect(buildUpstreamUrl(base, op)).toBe(`${base}/api/files/${op}`)
    }
  })
})
